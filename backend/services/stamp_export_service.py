"""LINEスタンプセットのZIPエクスポートサービス。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from backend.models import ExportResult, ExportStampSet


_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


class StampExportService:
    """変換済み画像とメタデータを展開可能なZIPへまとめる。

    元画像は編集・再エクスポート・アップロードで引き続き利用するため削除しない。
    一時画像全体の破棄はアプリのライフサイクル管理側で行う。
    """

    def export(self, stamp_set: ExportStampSet, output_directory: str) -> ExportResult:
        """ZIPを作成する。同名ファイルがある場合は連番を付けて保持する。"""
        title = stamp_set.title.strip()
        if not title:
            raise ValueError("スタンプセットのタイトルを入力してください。")
        if not stamp_set.images:
            raise ValueError("エクスポートできるスタンプ画像がありません。")
        if not output_directory.strip():
            raise ValueError("ZIPの保存先を選択してください。")

        source_paths: list[tuple[Path, str]] = []
        width = max(2, len(str(len(stamp_set.images))))
        for index, image in enumerate(stamp_set.images, start=1):
            source_paths.append(
                (self._require_file(image.stamp_path), f"{index:0{width}d}.png")
            )

        representative = stamp_set.images[0]
        source_paths.extend(
            [
                (self._require_file(representative.main_image_path), "main.png"),
                (self._require_file(representative.thumbnail_path), "tab.png"),
            ]
        )

        directory = Path(output_directory).expanduser()
        directory.mkdir(parents=True, exist_ok=True)
        if not directory.is_dir():
            raise NotADirectoryError(f"保存先がディレクトリではありません: {directory}")

        file_stem = self.sanitize_file_stem(title)
        zip_path = self._reserve_unique_path(directory, file_stem)
        try:
            with ZipFile(zip_path, mode="w", compression=ZIP_DEFLATED) as archive:
                for source_path, archive_name in source_paths:
                    archive.write(source_path, arcname=archive_name)
                archive.writestr(
                    "metadata.json",
                    json.dumps(
                        {
                            "title": title,
                            "description": stamp_set.description,
                            "imageCount": len(stamp_set.images),
                        },
                        ensure_ascii=False,
                        indent=2,
                    ).encode("utf-8"),
                )
        except Exception:
            zip_path.unlink(missing_ok=True)
            raise

        return ExportResult(
            zip_path=str(zip_path.resolve()),
            file_name=zip_path.name,
            image_count=len(stamp_set.images),
        )

    @staticmethod
    def sanitize_file_stem(title: str) -> str:
        """OSで使用できない文字とWindows予約名を安全な名前へ変換する。"""
        sanitized = _INVALID_FILENAME_CHARS.sub("_", title.strip())
        sanitized = re.sub(r"\s+", " ", sanitized).rstrip(". ")[:80].rstrip(". ")
        if not sanitized:
            sanitized = "line-stamps"
        if sanitized.upper() in _WINDOWS_RESERVED_NAMES:
            sanitized = f"_{sanitized}"
        return sanitized

    @staticmethod
    def _require_file(raw_path: str) -> Path:
        path = Path(raw_path)
        if not raw_path.strip() or not path.is_file():
            raise FileNotFoundError(f"エクスポート対象の画像が見つかりません: {raw_path}")
        if path.suffix.lower() != ".png":
            raise ValueError(f"PNGではない画像はエクスポートできません: {raw_path}")
        return path

    @staticmethod
    def _reserve_unique_path(directory: Path, file_stem: str) -> Path:
        """上書きを避け、排他的作成で一意なZIPパスを確保する。"""
        suffix = 1
        while True:
            name = f"{file_stem}.zip" if suffix == 1 else f"{file_stem} ({suffix}).zip"
            candidate = directory / name
            try:
                candidate.touch(exist_ok=False)
                return candidate
            except FileExistsError:
                suffix += 1
