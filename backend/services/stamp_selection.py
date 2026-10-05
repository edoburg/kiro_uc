"""メイン画像・トークルームタブ画像の選択を解決・検証する共通処理。

ZIPエクスポート（main.png / tab.png）と LINE アップロード（メイン画像 / タブ画像）は
必ずこのモジュールで選択を解決し、同じ派生画像ファイルを使う。

互換方針:
  - 選択フィールド（mainImageId / tabImageId）を両方とも持たない旧要求だけ、
    従来どおり images[0] の派生画像を使う（``selection is None``）。
  - 選択フィールドがある要求では、未選択（None）・片方の欠落・セット外のID・
    画像IDの欠落や重複・無効な派生画像はすべてエラーにし、先頭画像へ補正しない。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional, Sequence

from PIL import Image

from backend.models import RepresentativeImages, RepresentativeSelection
from backend.services.image_processor_service import ImageProcessorService


class RepresentativeSelectionError(ValueError):
    """選択IDまたは選択画像が不正（HTTP 400 相当）。"""


_MAIN_LABEL = "メイン画像"
_TAB_LABEL = "トークルームタブ画像"


def resolve_representative_images(
    images: Sequence[Any],
    selection: Optional[RepresentativeSelection],
) -> RepresentativeImages:
    """選択IDを images 内の画像へ解決し、対象の派生画像ファイルを検証する。

    Args:
        images:    ``id`` / ``main_image_path`` / ``thumbnail_path`` 属性を持つ画像の列。
                   出力対象の順序のまま渡す（インデックスは結果の参考情報にのみ使う）。
        selection: 明示的な選択。None は選択フィールドのない旧要求。

    Raises:
        RepresentativeSelectionError: 選択IDが不正、または派生画像の形式・サイズが規格外。
        FileNotFoundError:            選択した派生画像ファイルが存在しない。
    """
    if not images:
        raise RepresentativeSelectionError("エクスポートできるスタンプ画像がありません。")

    if selection is None:
        main_index = tab_index = 0
    else:
        ids = [getattr(image, "id", None) for image in images]
        if any(not isinstance(image_id, str) or not image_id for image_id in ids):
            raise RepresentativeSelectionError(
                "メイン画像・タブ画像を選択する場合は、すべての画像にIDが必要です。"
            )
        if len(set(ids)) != len(ids):
            raise RepresentativeSelectionError("スタンプ画像のIDが重複しています。")
        main_index = _find_index(ids, selection.main_image_id, _MAIN_LABEL)
        tab_index = _find_index(ids, selection.tab_image_id, _TAB_LABEL)

    main_image = images[main_index]
    tab_image = images[tab_index]
    main_path = str(getattr(main_image, "main_image_path", "") or "")
    tab_path = str(getattr(tab_image, "thumbnail_path", "") or "")
    validate_derived_image(
        main_path,
        ImageProcessorService.MAIN_W,
        ImageProcessorService.MAIN_H,
        _MAIN_LABEL,
    )
    validate_derived_image(
        tab_path,
        ImageProcessorService.THUMB_W,
        ImageProcessorService.THUMB_H,
        _TAB_LABEL,
    )
    return RepresentativeImages(
        main_image_id=getattr(main_image, "id", None),
        main_index=main_index,
        main_image_path=main_path,
        tab_image_id=getattr(tab_image, "id", None),
        tab_index=tab_index,
        tab_image_path=tab_path,
    )


def _find_index(ids: list[Any], image_id: Optional[str], label: str) -> int:
    if image_id is None:
        raise RepresentativeSelectionError(
            f"{label}が選択されていません。編集画面で{label}に使う画像を選んでください。"
        )
    if not isinstance(image_id, str) or not image_id:
        raise RepresentativeSelectionError(f"{label}の選択IDが不正です。")
    try:
        return ids.index(image_id)
    except ValueError:
        raise RepresentativeSelectionError(
            f"選択された{label}（ID: {image_id}）がスタンプセット内に見つかりません。"
        ) from None


def validate_derived_image(
    raw_path: str, expected_w: int, expected_h: int, label: str
) -> None:
    """派生画像が存在し、PNG・規定サイズ・1MB以下であることを確認する。"""
    path = Path(raw_path)
    if not raw_path.strip() or not path.is_file():
        raise FileNotFoundError(f"{label}のファイルが見つかりません: {raw_path}")
    if path.suffix.lower() != ".png":
        raise RepresentativeSelectionError(f"{label}がPNGファイルではありません: {raw_path}")
    size = path.stat().st_size
    if size > ImageProcessorService.MAX_FILE_BYTES:
        raise RepresentativeSelectionError(
            f"{label}のファイルサイズが上限を超えています（{size} バイト）。"
        )
    try:
        with Image.open(path) as probe:
            fmt = (probe.format or "").upper()
            width, height = probe.size
    except Exception as exc:  # noqa: BLE001 - 破損画像を規格外として扱う
        raise RepresentativeSelectionError(f"{label}を画像として読み込めません: {raw_path}") from exc
    if fmt != "PNG":
        raise RepresentativeSelectionError(f"{label}がPNG形式ではありません: {raw_path}")
    if (width, height) != (expected_w, expected_h):
        raise RepresentativeSelectionError(
            f"{label}のサイズが規格外です（{width}×{height}px、必要: {expected_w}×{expected_h}px）。"
        )
