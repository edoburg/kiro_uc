"""
ImageProcessorService のプロパティベーステスト

タスク 5.3 / Property 6: ファイルサイズ 1MB 以下保証
compress_to_limit(img, max_bytes) が返す (data, exceeded) について、
圧縮・縮小で収まる場合は len(data) <= max_bytes となり、
どうしても収まらない場合は exceeded=True が返る。

すなわち任意の入力に対して: (len(data) <= max_bytes) OR (exceeded is True)。

Validates: Requirements 3.3
"""

from __future__ import annotations

import io

from hypothesis import given, settings
from hypothesis import strategies as st
from PIL import Image

from backend.services.image_processor_service import ImageProcessorService

_service = ImageProcessorService()


# ---------------------------------------------------------------------------
# 画像生成ストラテジ
# ---------------------------------------------------------------------------


def _make_image(
    width: int, height: int, seed: int, mode: str, noise: bool
) -> Image.Image:
    """
    テスト用の画像を生成する。

    noise=True の場合はピクセルごとにばらついた内容にし、PNG が圧縮しにくい
    （＝ファイルサイズが大きくなりやすい）画像を作る。small max_bytes と
    組み合わせることで exceeded パスを確実に通す。
    """
    if noise:
        # 疑似ランダムなピクセルで圧縮しにくい画像を作る
        img = Image.new(mode, (width, height))
        px = img.load()
        state = seed & 0xFFFFFFFF
        bands = len(img.getbands())
        for y in range(height):
            for x in range(width):
                vals = []
                for _ in range(bands):
                    state = (1103515245 * state + 12345) & 0xFFFFFFFF
                    vals.append((state >> 16) & 0xFF)
                px[x, y] = tuple(vals) if bands > 1 else vals[0]
        return img
    # 単色に近い（圧縮しやすい）画像
    color_val = seed & 0xFF
    bands = len(Image.new(mode, (1, 1)).getbands())
    color = tuple([color_val] * bands) if bands > 1 else color_val
    return Image.new(mode, (width, height), color)


@st.composite
def _images(draw: st.DrawFn) -> Image.Image:
    width = draw(st.integers(min_value=1, max_value=400))
    height = draw(st.integers(min_value=1, max_value=350))
    seed = draw(st.integers(min_value=0, max_value=2**31 - 1))
    mode = draw(st.sampled_from(["RGB", "RGBA", "L"]))
    noise = draw(st.booleans())
    return _make_image(width, height, seed, mode, noise)


# ---------------------------------------------------------------------------
# Property 6: ファイルサイズ 1MB 以下保証
# ---------------------------------------------------------------------------

# Feature: line-stamp-generator, Property 6: ファイルサイズ 1MB 以下保証


@given(
    img=_images(),
    max_bytes=st.sampled_from(
        [
            # 通常運用の上限（1MB）
            ImageProcessorService.MAX_FILE_BYTES,
            # 圧縮・縮小でも収まりにくい極端に小さい上限 → exceeded パスを exercise する
            50,
            200,
            1_000,
            10_000,
        ]
    ),
)
@settings(max_examples=100)
def test_compress_to_limit_within_bytes_or_exceeded(
    img: Image.Image, max_bytes: int
) -> None:
    """
    任意の入力画像・任意の max_bytes に対して、compress_to_limit の返す
    (data, exceeded) は以下のいずれかを満たす:
      - len(data) <= max_bytes （圧縮・縮小で収まった）
      - exceeded is True        （どうしても収まらなかった）

    Validates: Requirements 3.3
    """
    data, exceeded = _service.compress_to_limit(img, max_bytes)

    # 返却されるのは有効な PNG バイト列であること
    assert isinstance(data, bytes)
    assert isinstance(exceeded, bool)
    with Image.open(io.BytesIO(data)) as probe:
        probe.load()
        assert (probe.format or "").upper() == "PNG"

    # 中心となる保証: 上限内に収まっている、または超過フラグが立っている
    assert (len(data) <= max_bytes) or (exceeded is True)

    # exceeded=False を主張する場合は必ず上限内でなければならない（Property 6 の要点）
    if not exceeded:
        assert len(data) <= max_bytes


@given(img=_images())
@settings(max_examples=100)
def test_stamp_output_within_1mb_or_flagged(img: Image.Image) -> None:
    """
    スタンプ規格へ変換した画像を 1MB 上限で圧縮したとき、
    出力は 1,048,576 バイト以下、もしくは file_size_exceeded 相当の
    exceeded=True が立つ。

    Validates: Requirements 3.3
    """
    stamp = _service.resize_to_stamp(img)
    data, exceeded = _service.compress_to_limit(
        stamp, ImageProcessorService.MAX_FILE_BYTES
    )

    assert (len(data) <= ImageProcessorService.MAX_FILE_BYTES) or (exceeded is True)
    if not exceeded:
        assert len(data) <= ImageProcessorService.MAX_FILE_BYTES
