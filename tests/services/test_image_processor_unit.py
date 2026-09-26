"""
ImageProcessorService.process_image の具体例ベースのユニットテスト（pytest）

Task 5.6 / Requirements 3.1, 3.2, 3.6

- 具体的なサイズ入力例: 800×600px の入力画像 → スタンプ画像が 370×320px 以内に収まる
- メイン画像は 240×240px の PNG、サムネイルは 96×74px の PNG
- 出力ファイルが実際に生成される
- 通常画像では ValidationResult.passed が True
- 出力 PNG は透過（RGBA）を保持する

pyproject.toml で asyncio_mode = "auto" が設定されているため、async 関数の
テストをそのまま記述する。Windows のファイルロックを避けるため、Pillow の
ハンドルは with / .close() で確実に閉じる。
"""

from __future__ import annotations

import os

import pytest
from PIL import Image

from backend.services.image_processor_service import ImageProcessorService


# LINE 規格定数（tech.md / structure.md）
STAMP_MAX_W, STAMP_MAX_H = 370, 320
MAIN_W, MAIN_H = 240, 240
THUMB_W, THUMB_H = 96, 74


def _write_source_png(dir_path: str, width: int, height: int, name: str = "source.png") -> str:
    """指定サイズのテスト用 PNG をディレクトリに書き出し、パスを返す。"""
    source_path = os.path.join(dir_path, name)
    # 単色ではなくグラデーションで、圧縮後もある程度中身のある画像にする
    img = Image.new("RGBA", (width, height))
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            pixels[x, y] = (x % 256, y % 256, (x + y) % 256, 255)
    try:
        img.save(source_path, format="PNG")
    finally:
        img.close()
    return source_path


def _open_size_and_mode(path: str):
    """画像を開いてサイズ・フォーマット・モードを取得し、ハンドルを閉じる。"""
    with Image.open(path) as im:
        im.load()
        return im.size, (im.format or "").upper(), im.mode


@pytest.fixture()
def service() -> ImageProcessorService:
    return ImageProcessorService()


async def test_process_image_stamp_within_line_size(service, tmp_path):
    """800×600px 入力 → スタンプ画像が 370×320px 以内に収まる（Requirements 3.1）"""
    source_path = _write_source_png(str(tmp_path), 800, 600)

    result = await service.process_image(source_path)

    (w, h), fmt, mode = _open_size_and_mode(result.stamp_path)
    assert w <= STAMP_MAX_W, f"スタンプ幅超過: {w}px"
    assert h <= STAMP_MAX_H, f"スタンプ高さ超過: {h}px"
    assert fmt == "PNG"
    assert mode == "RGBA"


async def test_process_image_main_is_240x240_png(service, tmp_path):
    """メイン画像は 240×240px の PNG（Requirements 3.2）"""
    source_path = _write_source_png(str(tmp_path), 800, 600)

    result = await service.process_image(source_path)

    (w, h), fmt, _ = _open_size_and_mode(result.main_image_path)
    assert (w, h) == (MAIN_W, MAIN_H)
    assert fmt == "PNG"


async def test_process_image_thumbnail_is_96x74_png(service, tmp_path):
    """サムネイル画像は 96×74px の PNG（Requirements 3.2）"""
    source_path = _write_source_png(str(tmp_path), 800, 600)

    result = await service.process_image(source_path)

    (w, h), fmt, _ = _open_size_and_mode(result.thumbnail_path)
    assert (w, h) == (THUMB_W, THUMB_H)
    assert fmt == "PNG"


async def test_process_image_creates_output_files(service, tmp_path):
    """3 種類すべての出力ファイルが生成される（Requirements 3.6）"""
    source_path = _write_source_png(str(tmp_path), 800, 600)

    result = await service.process_image(source_path)

    assert os.path.exists(result.stamp_path)
    assert os.path.exists(result.main_image_path)
    assert os.path.exists(result.thumbnail_path)
    # 3 種類はそれぞれ別ファイルであること
    paths = {result.stamp_path, result.main_image_path, result.thumbnail_path}
    assert len(paths) == 3


async def test_process_image_validation_passed_for_normal_image(service, tmp_path):
    """通常の画像では ValidationResult.passed が True（Requirements 3.1, 3.6）"""
    source_path = _write_source_png(str(tmp_path), 800, 600)

    result = await service.process_image(source_path)

    assert result.validation.passed is True
    assert result.validation.size_ok is True
    assert result.validation.format_ok is True
    assert result.validation.file_size_ok is True
    assert result.validation.file_size_exceeded is False


async def test_process_image_outputs_have_transparency_rgba(service, tmp_path):
    """出力 PNG はすべて透過（RGBA）を保持する（Requirements 3.1, 3.2）"""
    source_path = _write_source_png(str(tmp_path), 800, 600)

    result = await service.process_image(source_path)

    for path in (result.stamp_path, result.main_image_path, result.thumbnail_path):
        _, _, mode = _open_size_and_mode(path)
        assert mode == "RGBA", f"透過が保持されていません: {path} (mode={mode})"
