"""StampExportServiceのZIP内容・命名・エラー処理テスト。"""

from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZipFile

import pytest

from backend.models import ExportImage, ExportStampSet
from backend.services.stamp_export_service import StampExportService


def _create_stamp_set(tmp_path: Path, count: int = 2, title: str = "テスト/セット") -> ExportStampSet:
    images: list[ExportImage] = []
    for index in range(count):
        stamp = tmp_path / f"stamp-{index}.png"
        main = tmp_path / f"main-{index}.png"
        thumb = tmp_path / f"thumb-{index}.png"
        stamp.write_bytes(f"stamp-{index}".encode())
        main.write_bytes(f"main-{index}".encode())
        thumb.write_bytes(f"thumb-{index}".encode())
        images.append(ExportImage(str(stamp), str(main), str(thumb)))
    return ExportStampSet(title=title, description="説明文", images=images)


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
        assert archive.read("01.png") == b"stamp-0"
        assert archive.read("main.png") == b"main-0"
        assert archive.read("tab.png") == b"thumb-0"
        metadata = json.loads(archive.read("metadata.json").decode("utf-8"))
        assert metadata == {
            "title": "テスト/セット",
            "description": "説明文",
            "imageCount": 2,
        }
    # 編集・再エクスポート・アップロードで再利用するため、元画像は保持する。
    assert all(Path(image.stamp_path).is_file() for image in stamp_set.images)


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
