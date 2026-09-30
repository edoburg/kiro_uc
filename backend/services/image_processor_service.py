"""
ImageProcessorService — LINE 規格への画像変換・バリデーション（Pillow 使用）

各 Generated_Image から以下の 3 種類を生成する:
  - スタンプ画像:   W370 × H320px 以内、透過 PNG、1MB 以下
  - メイン画像:     W240 × H240px、PNG
  - サムネイル画像: W96  × H74px、PNG

処理方針:
  - スタンプ画像は元画像全体をアスペクト比を保って最大サイズ内に縮小する
  - サムネイル画像は元画像全体を縮小し、透明な余白を足して規定サイズにする
  - メイン画像のみ正方形に中央クロップする
  - PNG 圧縮レベルを段階的に上げて 1MB 以下に収め、超過時は file_size_exceeded=True をセットする
  - バッチ変換では個別画像のエラーを記録しつつ、他画像の変換を継続する

structure.md の規約に従い、本サービスはステートレスとする（1 回インスタンス化して注入する）。
ユーザー向けメッセージは日本語で記述する（product.md）。
"""

from __future__ import annotations

import base64
import io
import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

from PIL import Image

from backend.models import ProcessedImageSet, ValidationResult


@dataclass
class BatchProcessError:
    """バッチ変換中に発生した個別画像のエラー情報（Requirements 3.7）"""

    index: int
    """エラーが発生した画像インデックス"""

    source_path: str
    """エラーが発生した入力画像パス"""

    message: str
    """エラーメッセージ（日本語）"""


@dataclass
class BatchProcessResult:
    """バッチ変換の結果。成功分と失敗分を分けて保持する。"""

    results: List[Optional[ProcessedImageSet]]
    """各インデックスの変換結果（失敗した位置は None）"""

    errors: List[BatchProcessError]
    """発生した個別エラーのリスト"""


class ImageProcessorService:
    """
    LINE 規格への画像変換・バリデーションサービス（ステートレス）。

    Attributes:
        STAMP_MAX_W / STAMP_MAX_H: スタンプ画像の最大サイズ
        MAIN_W / MAIN_H:           メイン画像のサイズ
        THUMB_W / THUMB_H:         サムネイル画像のサイズ
        MAX_FILE_BYTES:            スタンプ画像の最大ファイルサイズ（1MB）
    """

    # LINE 規格定数
    STAMP_MAX_W = 370
    STAMP_MAX_H = 320
    MAIN_W, MAIN_H = 240, 240
    THUMB_W, THUMB_H = 96, 74
    MAX_FILE_BYTES = 1_048_576  # 1MB

    # スタンプ規格のアスペクト比 37:32（= STAMP_MAX_W : STAMP_MAX_H）
    ASPECT_W = STAMP_MAX_W  # 370
    ASPECT_H = STAMP_MAX_H  # 320

    # PNG 圧縮レベルの段階（0=無圧縮 〜 9=最大圧縮）
    _COMPRESS_LEVELS = (6, 7, 8, 9)

    # 1MB を超えた場合のフォールバック縮小率（圧縮レベル最大でも超過するケース向け）
    _DOWNSCALE_FACTORS = (0.9, 0.8, 0.7, 0.6, 0.5)

    # ------------------------------------------------------------------
    # クロップ / リサイズ
    # ------------------------------------------------------------------

    def center_crop_to_aspect(
        self, img: Image.Image, target_w: int, target_h: int
    ) -> Image.Image:
        """
        画像を目標アスペクト比（target_w:target_h）に中央クロップする（Requirements 3.5）。

        入力画像のアスペクト比が目標比率と異なる場合、中央を基点に切り出して
        目標比率に一致させる。既に目標比率と等しい場合はそのまま返す。

        Args:
            img:      入力画像
            target_w: 目標アスペクト比の幅成分
            target_h: 目標アスペクト比の高さ成分

        Returns:
            中央クロップ後の画像
        """
        src_w, src_h = img.size
        if src_w == 0 or src_h == 0:
            return img

        target_ratio = target_w / target_h
        src_ratio = src_w / src_h

        # 既に目標比率と一致していればそのまま返す
        if abs(src_ratio - target_ratio) < 1e-9:
            return img

        if src_ratio > target_ratio:
            # 横に長すぎる → 幅を削る
            new_w = int(round(src_h * target_ratio))
            new_w = min(new_w, src_w)
            new_h = src_h
        else:
            # 縦に長すぎる → 高さを削る
            new_h = int(round(src_w / target_ratio))
            new_h = min(new_h, src_h)
            new_w = src_w

        left = (src_w - new_w) // 2
        top = (src_h - new_h) // 2
        return img.crop((left, top, left + new_w, top + new_h))

    def resize_to_stamp(self, img: Image.Image) -> Image.Image:
        """
        画像をスタンプ規格（W370 × H320px 以内、透過 PNG）に変換する
        （Requirements 3.1, 3.5）。

        元画像を切り抜かず、アスペクト比を保って最大サイズ以内に縮小する。
        透過を保持するため RGBA へ変換する。

        Args:
            img: 入力画像

        Returns:
            スタンプ規格に調整済みの RGBA 画像
        """
        resized = self._fit_within(img, self.STAMP_MAX_W, self.STAMP_MAX_H)
        return self._to_rgba(resized)

    def _make_main(self, img: Image.Image) -> Image.Image:
        """メイン画像（W240 × H240px、PNG）を生成する（Requirements 3.2）。"""
        cropped = self.center_crop_to_aspect(img, self.MAIN_W, self.MAIN_H)
        resized = cropped.resize((self.MAIN_W, self.MAIN_H), Image.LANCZOS)
        return self._to_rgba(resized)

    def _make_thumbnail(self, img: Image.Image) -> Image.Image:
        """画像全体を縮小して透明な 96×74px の中央に配置する（Requirements 3.2）。"""
        src_w, src_h = img.size
        scale = min(self.THUMB_W / src_w, self.THUMB_H / src_h)
        width = min(self.THUMB_W, max(1, round(src_w * scale)))
        height = min(self.THUMB_H, max(1, round(src_h * scale)))
        resized = self._to_rgba(img).resize((width, height), Image.LANCZOS)
        canvas = Image.new("RGBA", (self.THUMB_W, self.THUMB_H), (0, 0, 0, 0))
        canvas.alpha_composite(
            resized,
            dest=((self.THUMB_W - width) // 2, (self.THUMB_H - height) // 2),
        )
        return canvas

    # ------------------------------------------------------------------
    # 圧縮 / バリデーション
    # ------------------------------------------------------------------

    def compress_to_limit(
        self, img: Image.Image, max_bytes: int
    ) -> Tuple[bytes, bool]:
        """
        画像を PNG エンコードし、max_bytes 以下に収める（Requirements 3.3, 3.8）。

        まず PNG 圧縮レベルを段階的に上げ、それでも超過する場合は
        画像を段階的に縮小する。最大レベルの圧縮・縮小でも超過する場合は
        exceeded=True を返す。

        Args:
            img:       PNG 化する画像
            max_bytes: 許容する最大バイト数

        Returns:
            (PNG バイト列, exceeded)。
            exceeded が True の場合はどうしても max_bytes 以下に収まらなかったことを示す。
        """
        rgba = self._to_rgba(img)

        best: bytes = self._encode_png(rgba, compress_level=self._COMPRESS_LEVELS[0])

        # 1) 圧縮レベルを段階的に上げる
        for level in self._COMPRESS_LEVELS:
            data = self._encode_png(rgba, compress_level=level)
            if len(data) < len(best):
                best = data
            if len(data) <= max_bytes:
                return data, False

        # 2) 圧縮レベル最大でも超過 → 段階的に縮小する
        base_w, base_h = rgba.size
        for factor in self._DOWNSCALE_FACTORS:
            new_w = max(1, int(base_w * factor))
            new_h = max(1, int(base_h * factor))
            scaled = rgba.resize((new_w, new_h), Image.LANCZOS)
            data = self._encode_png(scaled, compress_level=self._COMPRESS_LEVELS[-1])
            if len(data) < len(best):
                best = data
            if len(data) <= max_bytes:
                return data, False

        # 3) どうしても収まらない → 最小サイズの結果を返し exceeded=True
        return best, True

    def validate(
        self, img_bytes: bytes, expected_w: int, expected_h: int
    ) -> ValidationResult:
        """
        PNG バイト列が LINE 規格を満たすか検証する（Requirements 3.3, 3.4, 3.8）。

        Args:
            img_bytes:  検証対象の PNG バイト列
            expected_w: 許容する最大幅（この値以下なら適合）
            expected_h: 許容する最大高さ（この値以下なら適合）

        Returns:
            サイズ・フォーマット・ファイルサイズの適合状況を含む ValidationResult
        """
        size_ok = False
        format_ok = False
        width = height = 0
        fmt = "unknown"

        try:
            with Image.open(io.BytesIO(img_bytes)) as probe:
                probe.load()
                width, height = probe.size
                fmt = (probe.format or "").upper()
                has_alpha = probe.mode in ("RGBA", "LA") or (
                    probe.mode == "P" and "transparency" in probe.info
                )
                size_ok = width <= expected_w and height <= expected_h
                format_ok = fmt == "PNG" and has_alpha
        except Exception:  # noqa: BLE001 - 破損画像・非画像バイト列を許容
            size_ok = False
            format_ok = False

        file_size = len(img_bytes)
        file_size_ok = file_size <= self.MAX_FILE_BYTES
        # 圧縮でも収まらないケースは compress_to_limit の結果と併せて呼び出し側が判断するが、
        # ここでは単純にサイズ超過をそのまま反映する。
        file_size_exceeded = not file_size_ok

        passed = size_ok and format_ok and file_size_ok

        if passed:
            details = "LINE 規格に適合しています。"
        else:
            problems: List[str] = []
            if not size_ok:
                problems.append(
                    f"サイズ超過（{width}×{height}px、上限 {expected_w}×{expected_h}px）"
                )
            if not format_ok:
                problems.append("フォーマット不適合（透過 PNG である必要があります）")
            if not file_size_ok:
                problems.append(
                    f"ファイルサイズ超過（{file_size} バイト、上限 {self.MAX_FILE_BYTES} バイト）"
                )
            details = "、".join(problems)

        return ValidationResult(
            passed=passed,
            size_ok=size_ok,
            format_ok=format_ok,
            file_size_ok=file_size_ok,
            file_size_exceeded=file_size_exceeded,
            details=details,
        )

    # ------------------------------------------------------------------
    # 単一画像の変換
    # ------------------------------------------------------------------

    async def process_image(self, source_path: str) -> ProcessedImageSet:
        """
        1 枚の入力画像からスタンプ・メイン・サムネイルの 3 種類を生成し、
        LINE 規格に変換・保存する（Requirements 3.1, 3.2, 3.3, 3.6）。

        出力ファイルは入力画像と同じディレクトリに派生名で保存する。

        Args:
            source_path: 入力画像のパス

        Returns:
            変換済みの 3 種類の画像パスとバリデーション結果を含む ProcessedImageSet

        Raises:
            FileNotFoundError: 入力ファイルが存在しない場合
            OSError:           画像の読み込み／書き込みに失敗した場合
        """
        if not os.path.exists(source_path):
            raise FileNotFoundError(
                f"入力画像が見つかりません: {source_path}"
            )

        base, _ = os.path.splitext(source_path)
        stamp_path = f"{base}_stamp.png"
        main_path = f"{base}_main.png"
        thumb_path = f"{base}_thumb.png"

        with Image.open(source_path) as src:
            src.load()
            source = self._to_rgba(src)

        # スタンプ画像: 1MB 以下に圧縮する
        stamp_img = self.resize_to_stamp(source)
        stamp_bytes, exceeded = self.compress_to_limit(stamp_img, self.MAX_FILE_BYTES)
        self._write_bytes(stamp_path, stamp_bytes)

        # メイン・サムネイル画像
        main_img = self._make_main(source)
        main_bytes = self._encode_png(main_img, compress_level=self._COMPRESS_LEVELS[-1])
        self._write_bytes(main_path, main_bytes)

        thumb_img = self._make_thumbnail(source)
        thumb_bytes = self._encode_png(
            thumb_img, compress_level=self._COMPRESS_LEVELS[-1]
        )
        self._write_bytes(thumb_path, thumb_bytes)

        # スタンプ画像を基準にバリデーション（サイズ・フォーマット・ファイルサイズ）
        validation = self.validate(stamp_bytes, self.STAMP_MAX_W, self.STAMP_MAX_H)
        if exceeded:
            # 圧縮最大でも 1MB 超過（調整不可）を記録する（Requirements 3.8）
            validation.file_size_ok = False
            validation.file_size_exceeded = True
            validation.passed = False
            validation.details = (
                "ファイルサイズ超過（調整不可）。別の画像への差し替えをおすすめします。"
            )

        return ProcessedImageSet(
            stamp_path=stamp_path,
            main_image_path=main_path,
            thumbnail_path=thumb_path,
            validation=validation,
            stamp_data_url=self._png_data_url(stamp_bytes),
            main_image_data_url=self._png_data_url(main_bytes),
            thumbnail_data_url=self._png_data_url(thumb_bytes),
        )

    # ------------------------------------------------------------------
    # バッチ変換（個別エラーを記録しつつ継続）
    # ------------------------------------------------------------------

    async def process_batch(self, source_paths: List[str]) -> BatchProcessResult:
        """
        複数の入力画像をバッチ変換する（Requirements 3.7）。

        ある画像で読み込み／書き込みエラーが発生しても、その画像のみエラーとして
        記録し、他の画像の変換処理を継続する。

        Args:
            source_paths: 入力画像パスのリスト

        Returns:
            各インデックスの変換結果（失敗は None）とエラー一覧を含む BatchProcessResult
        """
        results: List[Optional[ProcessedImageSet]] = []
        errors: List[BatchProcessError] = []

        for index, path in enumerate(source_paths):
            try:
                processed = await self.process_image(path)
                results.append(processed)
            except Exception as exc:  # noqa: BLE001 - 個別エラーを記録して継続
                results.append(None)
                errors.append(
                    BatchProcessError(
                        index=index,
                        source_path=path,
                        message=(
                            f"画像 {index} の変換に失敗しました: {exc}"
                        ),
                    )
                )

        return BatchProcessResult(results=results, errors=errors)

    # ------------------------------------------------------------------
    # 内部ユーティリティ
    # ------------------------------------------------------------------

    @staticmethod
    def _to_rgba(img: Image.Image) -> Image.Image:
        """画像を透過対応の RGBA モードへ変換する。"""
        if img.mode == "RGBA":
            return img
        return img.convert("RGBA")

    @staticmethod
    def _fit_within(img: Image.Image, max_w: int, max_h: int) -> Image.Image:
        """
        アスペクト比を保ったまま max_w × max_h 以内に収める。
        既に収まっている場合は縮小しない（拡大もしない）。
        """
        src_w, src_h = img.size
        if src_w <= max_w and src_h <= max_h:
            return img
        scale = min(max_w / src_w, max_h / src_h)
        new_w = max(1, int(src_w * scale))
        new_h = max(1, int(src_h * scale))
        return img.resize((new_w, new_h), Image.LANCZOS)

    @staticmethod
    def _encode_png(img: Image.Image, compress_level: int) -> bytes:
        """画像を指定圧縮レベルで PNG バイト列にエンコードする。"""
        buffer = io.BytesIO()
        img.save(buffer, format="PNG", optimize=True, compress_level=compress_level)
        return buffer.getvalue()

    @staticmethod
    def _write_bytes(path: str, data: bytes) -> None:
        """バイト列をファイルに書き込む。"""
        with open(path, "wb") as fp:
            fp.write(data)

    @staticmethod
    def _png_data_url(data: bytes) -> str:
        """PNGバイト列をレンダラー表示用のdata URLへ変換する。"""
        encoded = base64.b64encode(data).decode("ascii")
        return f"data:image/png;base64,{encoded}"
