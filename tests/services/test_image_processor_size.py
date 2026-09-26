"""
ImageProcessorService プロパティテスト（Property 5: LINE規格変換の出力サイズ保証）

Task 5.2 に対応。design.md の Property 5 / Requirements 3.1, 3.2 を検証する。

外部サービスには依存しない純粋な画像変換のテスト。実ファイルは tmp_path 配下にのみ
作成し、~/.line-stamp-gen には一切触れない。Windows のファイルロックを避けるため、
Pillow の Image ハンドルは with / close で確実に解放する。
"""

from __future__ import annotations

import io
import os

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from PIL import Image

from backend.services.image_processor_service import ImageProcessorService

_service = ImageProcessorService()


# ---------------------------------------------------------------------------
# 入力画像ジェネレーター
# ---------------------------------------------------------------------------

# 変換ロジックを十分に踏むよう、極端に細長い比率〜正方形まで、
# また複数のカラーモードを網羅する。サイズは処理時間を抑えつつ
# アスペクト比のバリエーションが出る範囲に制約する。
_dimensions = st.integers(min_value=1, max_value=800)
_modes = st.sampled_from(["RGB", "RGBA", "L", "P"])
_colors = st.integers(min_value=0, max_value=255)


def _make_source_image(width: int, height: int, mode: str, color: int) -> Image.Image:
    """指定サイズ・モードの単色入力画像を生成する。"""
    if mode == "RGBA":
        fill = (color, color, color, 255)
    elif mode == "RGB":
        fill = (color, color, color)
    else:  # "L" | "P"
        fill = color
    return Image.new(mode, (width, height), fill)


# Feature: line-stamp-generator, Property 5: LINE規格変換の出力サイズ保証
@given(
    width=_dimensions,
    height=_dimensions,
    mode=_modes,
    color=_colors,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
async def test_process_image_output_sizes(
    tmp_path_factory, width: int, height: int, mode: str, color: int
) -> None:
    """
    Property 5: 任意のサイズ・形式の入力画像に対し、process_image 完了後は
      - スタンプ画像:   370×320px 以内の透過 PNG
      - メイン画像:     厳密に 240×240px の PNG
      - サムネイル画像: 厳密に 96×74px の PNG
    となることを検証する。

    **Validates: Requirements 3.1, 3.2**
    """
    tmp_dir = tmp_path_factory.mktemp("prop5")
    source_path = os.fspath(tmp_dir / "source.png")

    # 入力画像を作成（ハンドルは確実に close する）
    src = _make_source_image(width, height, mode, color)
    try:
        src.save(source_path, format="PNG")
    finally:
        src.close()

    result = await _service.process_image(source_path)

    # --- スタンプ画像: 370×320px 以内 かつ 透過 PNG ---
    with Image.open(result.stamp_path) as stamp:
        stamp.load()
        stamp_w, stamp_h = stamp.size
        assert (stamp.format or "").upper() == "PNG"
        assert stamp.mode == "RGBA"  # 透過保持
        assert stamp_w <= ImageProcessorService.STAMP_MAX_W
        assert stamp_h <= ImageProcessorService.STAMP_MAX_H
        assert stamp_w >= 1 and stamp_h >= 1

    # --- メイン画像: 厳密に 240×240px の PNG ---
    with Image.open(result.main_image_path) as main:
        main.load()
        assert (main.format or "").upper() == "PNG"
        assert main.size == (
            ImageProcessorService.MAIN_W,
            ImageProcessorService.MAIN_H,
        )

    # --- サムネイル画像: 厳密に 96×74px の PNG ---
    with Image.open(result.thumbnail_path) as thumb:
        thumb.load()
        assert (thumb.format or "").upper() == "PNG"
        assert thumb.size == (
            ImageProcessorService.THUMB_W,
            ImageProcessorService.THUMB_H,
        )


# Feature: line-stamp-generator, Property 5: LINE規格変換の出力サイズ保証（同期変換パス）
@given(
    width=_dimensions,
    height=_dimensions,
    mode=_modes,
    color=_colors,
)
@settings(max_examples=100)
def test_resize_to_stamp_within_limits(
    width: int, height: int, mode: str, color: int
) -> None:
    """
    Property 5 の同期部分: resize_to_stamp は入力に依らず
    370×320px 以内の RGBA 画像を返す（Requirements 3.1）。

    ディスク I/O を伴わないため、より広い入力空間を安価に検証できる。

    **Validates: Requirements 3.1**
    """
    src = _make_source_image(width, height, mode, color)
    stamp = None
    try:
        stamp = _service.resize_to_stamp(src)
        w, h = stamp.size
        assert stamp.mode == "RGBA"
        assert w <= ImageProcessorService.STAMP_MAX_W
        assert h <= ImageProcessorService.STAMP_MAX_H
        assert w >= 1 and h >= 1
        # PNG エンコードが成立することも確認（透過 PNG 出力の前提）
        buf = io.BytesIO()
        stamp.save(buf, format="PNG")
        assert buf.getvalue()[:8] == b"\x89PNG\r\n\x1a\n"
    finally:
        src.close()
        if stamp is not None:
            stamp.close()
