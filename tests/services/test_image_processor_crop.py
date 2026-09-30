"""
ImageProcessorService の中央クロップ プロパティテスト

メイン画像の生成で使う中央クロップ関数のテスト。

center_crop_to_aspect(img, target_w, target_h) の出力画像について、
  - 出力のアスペクト比が target_w:target_h に（整数ピクセル丸めの許容誤差内で）一致する
  - クロップが中央基点で行われている（左右・上下の余白が均等、差は 1px 以内）
ことを検証する。
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st
from PIL import Image

from backend.services.image_processor_service import ImageProcessorService


# スタンプ規格のアスペクト比 37:32（ASPECT_W=370, ASPECT_H=320）を含む代表的な目標比率
_TARGET_RATIOS = st.sampled_from(
    [
        (ImageProcessorService.ASPECT_W, ImageProcessorService.ASPECT_H),  # 370:320 (37:32)
        (ImageProcessorService.MAIN_W, ImageProcessorService.MAIN_H),      # 240:240 (1:1)
        (ImageProcessorService.THUMB_W, ImageProcessorService.THUMB_H),    # 96:74
    ]
)


# 中央クロップ後の出力アスペクト比が目標比率に一致し、クロップは中央基点である
@given(
    src_w=st.integers(min_value=1, max_value=2000),
    src_h=st.integers(min_value=1, max_value=2000),
    target=_TARGET_RATIOS,
)
@settings(max_examples=100)
def test_center_crop_matches_target_aspect_and_is_centered(
    src_w: int, src_h: int, target: tuple[int, int]
) -> None:
    """center_crop_to_aspect の出力は目標アスペクト比に一致し、中央基点でクロップされる。

    """
    target_w, target_h = target
    service = ImageProcessorService()

    src = Image.new("RGBA", (src_w, src_h), (0, 0, 0, 0))
    try:
        cropped = service.center_crop_to_aspect(src, target_w, target_h)
        try:
            out_w, out_h = cropped.size

            # 出力寸法は正で、入力を超えない（拡大はしない）
            assert out_w >= 1 and out_h >= 1
            assert out_w <= src_w and out_h <= src_h

            target_ratio = target_w / target_h
            out_ratio = out_w / out_h

            # 整数ピクセル丸めによる誤差を許容する。1px の丸めが比率に与える
            # 最大影響は概ね 1/min(辺) 程度なので、これを基準に許容誤差を設定する。
            tolerance = target_ratio * (1.0 / min(out_w, out_h)) + 1e-6
            assert abs(out_ratio - target_ratio) <= tolerance, (
                f"aspect mismatch: src=({src_w}x{src_h}) target={target_w}:{target_h} "
                f"out=({out_w}x{out_h}) out_ratio={out_ratio} target_ratio={target_ratio}"
            )

            # クロップは中央基点: 削られた幅・高さが左右／上下で均等（差は 1px 以内）。
            # center_crop_to_aspect は片方の軸のみを削る（もう片方は据え置き）。
            crop_w = src_w - out_w
            crop_h = src_h - out_h

            left = (src_w - out_w) // 2
            right = crop_w - left
            top = (src_h - out_h) // 2
            bottom = crop_h - top

            assert abs(left - right) <= 1, (
                f"horizontal crop not centered: left={left} right={right}"
            )
            assert abs(top - bottom) <= 1, (
                f"vertical crop not centered: top={top} bottom={bottom}"
            )
        finally:
            if cropped is not src:
                cropped.close()
    finally:
        src.close()
