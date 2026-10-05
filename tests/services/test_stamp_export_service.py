"""StampExportServiceのZIP内容・命名・エラー処理・メイン／タブ画像選択のテスト。"""

from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZipFile

import pytest
from PIL import Image

from backend.models import ExportImage, ExportStampSet, RepresentativeSelection
from backend.services.stamp_export_service import StampExportService
from backend.services.stamp_selection import (
    RepresentativeSelectionError,
    resolve_representative_images,
)


def _write_png(path: Path, size: tuple[int, int], index: int) -> Path:
    """画像ごとに異なる色のPNGを書き、バイト列で取り違えを検出できるようにする。"""
    color = ((index * 37) % 256, (index * 91) % 256, (index * 53 + 17) % 256, 255)
    Image.new("RGBA", size, color).save(path, format="PNG")
    return path


def _create_stamp_set(
    tmp_path: Path,
    count: int = 2,
    title: str = "テスト/セット",
    selection: RepresentativeSelection | None = None,
) -> ExportStampSet:
    images: list[ExportImage] = []
    for index in range(count):
        stamp = _write_png(tmp_path / f"stamp-{index}.png", (370, 320), index)
        main = _write_png(tmp_path / f"main-{index}.png", (240, 240), index + 100)
        thumb = _write_png(tmp_path / f"thumb-{index}.png", (96, 74), index + 200)
        images.append(ExportImage(str(stamp), str(main), str(thumb), id=f"item-{index}"))
    return ExportStampSet(
        title=title, description="説明文", images=images, selection=selection
    )


def test_export_creates_expected_zip_contents(tmp_path: Path) -> None:
    output = tmp_path / "new" / "exports"
    stamp_set = _create_stamp_set(tmp_path)

    result = StampExportService().export(stamp_set, str(output))

    assert result.file_name == "テスト_セット.zip"
    assert result.image_count == 2
    with ZipFile(result.zip_path) as archive:
        assert set(archive.namelist()) == {
            "01.png",
            "02.png",
            "main.png",
            "tab.png",
            "metadata.json",
        }
        assert archive.read("01.png") == (tmp_path / "stamp-0.png").read_bytes()
        # 選択フィールドのない旧要求は従来どおり先頭画像を使う
        assert archive.read("main.png") == (tmp_path / "main-0.png").read_bytes()
        assert archive.read("tab.png") == (tmp_path / "thumb-0.png").read_bytes()
        metadata = json.loads(archive.read("metadata.json").decode("utf-8"))
        assert metadata == {
            "title": "テスト/セット",
            "description": "説明文",
            "imageCount": 2,
        }
    # 編集・再エクスポート・アップロードで再利用するため、元画像は保持する。
    assert all(Path(image.stamp_path).is_file() for image in stamp_set.images)


def test_export_uses_selected_main_and_tab_images_without_reordering(tmp_path: Path) -> None:
    """メインに3枚目、タブに5枚目を選ぶと、その派生画像のバイト列がZIPに入る。"""
    stamp_set = _create_stamp_set(
        tmp_path,
        count=8,
        selection=RepresentativeSelection(main_image_id="item-2", tab_image_id="item-4"),
    )

    result = StampExportService().export(stamp_set, str(tmp_path / "exports"))

    with ZipFile(result.zip_path) as archive:
        assert archive.read("main.png") == (tmp_path / "main-2.png").read_bytes()
        assert archive.read("tab.png") == (tmp_path / "thumb-4.png").read_bytes()
        assert archive.read("main.png") != (tmp_path / "main-0.png").read_bytes()
        assert archive.read("tab.png") != (tmp_path / "thumb-0.png").read_bytes()
        for index in range(8):
            assert (
                archive.read(f"{index + 1:02d}.png")
                == (tmp_path / f"stamp-{index}.png").read_bytes()
            )


def test_selection_uses_ids_not_positions_after_filtering(tmp_path: Path) -> None:
    """出力対象を絞り込んだ後でも、IDで同じ画像を参照する。"""
    stamp_set = _create_stamp_set(
        tmp_path,
        count=5,
        selection=RepresentativeSelection(main_image_id="item-3", tab_image_id="item-3"),
    )
    # 先頭2枚が出力対象外になった（例: 変換失敗）状況を再現する
    filtered = stamp_set.images[2:]

    resolved = resolve_representative_images(filtered, stamp_set.selection)

    assert resolved.main_image_path == str(tmp_path / "main-3.png")
    assert resolved.tab_image_path == str(tmp_path / "thumb-3.png")
    assert resolved.main_index == 1


@pytest.mark.parametrize(
    ("selection", "message"),
    [
        (RepresentativeSelection(main_image_id=None, tab_image_id="item-0"), "メイン画像が選択されていません"),
        (RepresentativeSelection(main_image_id="item-0", tab_image_id=None), "トークルームタブ画像が選択されていません"),
        (RepresentativeSelection(main_image_id="unknown", tab_image_id="item-0"), "見つかりません"),
        (RepresentativeSelection(main_image_id="item-0", tab_image_id="unknown"), "見つかりません"),
    ],
)
def test_export_rejects_explicit_invalid_selection_without_fallback(
    tmp_path: Path, selection: RepresentativeSelection, message: str
) -> None:
    stamp_set = _create_stamp_set(tmp_path, count=3, selection=selection)
    output = tmp_path / "exports"

    with pytest.raises(RepresentativeSelectionError, match=message):
        StampExportService().export(stamp_set, str(output))

    assert not output.exists()


def test_selection_requires_unique_image_ids(tmp_path: Path) -> None:
    stamp_set = _create_stamp_set(
        tmp_path,
        count=2,
        selection=RepresentativeSelection(main_image_id="item-0", tab_image_id="item-0"),
    )
    stamp_set.images[1].id = "item-0"
    with pytest.raises(RepresentativeSelectionError, match="重複"):
        resolve_representative_images(stamp_set.images, stamp_set.selection)

    stamp_set.images[1].id = None
    with pytest.raises(RepresentativeSelectionError, match="IDが必要"):
        resolve_representative_images(stamp_set.images, stamp_set.selection)


def test_selection_validates_derived_image_size_and_format(tmp_path: Path) -> None:
    stamp_set = _create_stamp_set(
        tmp_path,
        count=2,
        selection=RepresentativeSelection(main_image_id="item-1", tab_image_id="item-0"),
    )
    _write_png(tmp_path / "main-1.png", (370, 320), 1)
    with pytest.raises(RepresentativeSelectionError, match="サイズが規格外"):
        StampExportService().export(stamp_set, str(tmp_path / "exports"))

    (tmp_path / "main-1.png").write_bytes(b"not a png")
    with pytest.raises(RepresentativeSelectionError, match="読み込めません"):
        StampExportService().export(stamp_set, str(tmp_path / "exports"))

    (tmp_path / "main-1.png").unlink()
    with pytest.raises(FileNotFoundError, match="メイン画像のファイルが見つかりません"):
        StampExportService().export(stamp_set, str(tmp_path / "exports"))


def test_export_never_overwrites_existing_zip(tmp_path: Path) -> None:
    output = tmp_path / "exports"
    stamp_set = _create_stamp_set(tmp_path, title="same")
    service = StampExportService()

    first = service.export(stamp_set, str(output))
    second = service.export(stamp_set, str(output))

    assert Path(first.zip_path).name == "same.zip"
    assert Path(second.zip_path).name == "same (2).zip"
    assert Path(first.zip_path).is_file()
    assert Path(second.zip_path).is_file()


@pytest.mark.parametrize(
    ("title", "expected"),
    [("CON", "_CON"), ('a<>:"/\\|?*b. ', "a_________b"), ("...", "line-stamps")],
)
def test_sanitize_file_stem(title: str, expected: str) -> None:
    assert StampExportService.sanitize_file_stem(title) == expected


def test_export_rejects_missing_source_without_leaving_zip(tmp_path: Path) -> None:
    stamp_set = _create_stamp_set(tmp_path)
    stamp_set.images[0].stamp_path = str(tmp_path / "missing.png")
    output = tmp_path / "exports"

    with pytest.raises(FileNotFoundError, match="画像が見つかりません"):
        StampExportService().export(stamp_set, str(output))

    assert not output.exists()


def test_export_rejects_empty_set(tmp_path: Path) -> None:
    stamp_set = ExportStampSet(title="empty", description="", images=[])

    with pytest.raises(ValueError, match="スタンプ画像がありません"):
        StampExportService().export(stamp_set, str(tmp_path / "exports"))


def test_export_rejects_output_path_that_is_a_file(tmp_path: Path) -> None:
    stamp_set = _create_stamp_set(tmp_path)
    output_file = tmp_path / "not-a-directory"
    output_file.write_text("occupied", encoding="utf-8")

    with pytest.raises(OSError):
        StampExportService().export(stamp_set, str(output_file))

    assert output_file.read_text(encoding="utf-8") == "occupied"
