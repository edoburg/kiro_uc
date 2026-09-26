"""
ImageProcessorService.process_batch のプロパティベーステスト

タスク 5.5 / Property 8: バッチ変換のエラー継続処理
外部サービスは使用しない（実 PNG を一時ディレクトリに書き込んで検証する）。
process_batch は async のため async テスト関数として記述する（asyncio_mode=auto）。
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List

from hypothesis import given, settings
from hypothesis import strategies as st
from PIL import Image

from backend.models import ProcessedImageSet
from backend.services.image_processor_service import (
    BatchProcessError,
    ImageProcessorService,
)


# ---------------------------------------------------------------------------
# ヘルパ
# ---------------------------------------------------------------------------


def _write_valid_png(path: Path) -> None:
    """検証用の実 PNG（RGBA）を書き込む。Windows のためハンドルは即クローズする。"""
    img = Image.new("RGBA", (200, 173), (120, 200, 90, 255))
    try:
        img.save(str(path), format="PNG")
    finally:
        img.close()


# 各入力位置が「有効(True)」か「無効(False)」かを表すブール列。
# 少なくとも 1 つは有効・1 つは無効を含めて「失敗しても後続が成功する」ことを検証する。
_validity_lists = st.lists(st.booleans(), min_size=2, max_size=8).map(
    lambda flags: [True, False, *flags]
)


# ---------------------------------------------------------------------------
# Property 8: バッチ変換のエラー継続処理
# ---------------------------------------------------------------------------

# Feature: line-stamp-generator, Property 8: バッチ変換のエラー継続処理


@given(validity=_validity_lists)
@settings(max_examples=100)
async def test_process_batch_continues_on_errors(validity: List[bool]) -> None:
    """
    有効／無効な入力パスを交互に含むバッチについて、process_batch は
    一部が失敗しても他の画像の変換を継続する。

    - results の長さは入力数と一致する
    - 有効インデックスは None ではない ProcessedImageSet を返す
    - 無効インデックスは None で、errors に BatchProcessError として記録される
    - 成功数 + エラー数 = 入力数
    - 途中の失敗が後続の有効画像の成功を妨げない

    Validates: Requirements 3.7
    """
    # Hypothesis は関数スコープ fixture を例間でリセットしないため、
    # 例ごとに独立した一時ディレクトリを context manager で確保する。
    with tempfile.TemporaryDirectory() as tmp_dir:
        work_dir = Path(tmp_dir)
        service = ImageProcessorService()

        source_paths: List[str] = []
        valid_indices: List[int] = []
        invalid_indices: List[int] = []

        for i, is_valid in enumerate(validity):
            if is_valid:
                png_path = work_dir / f"img_{i}.png"
                _write_valid_png(png_path)
                source_paths.append(str(png_path))
                valid_indices.append(i)
            else:
                # 存在しないパス（変換は FileNotFoundError で失敗する）
                source_paths.append(str(work_dir / f"missing_{i}.png"))
                invalid_indices.append(i)

        result = await service.process_batch(source_paths)

    # results の長さは入力数と一致する
    assert len(result.results) == len(source_paths)

    # 有効インデックスは None ではない ProcessedImageSet
    for idx in valid_indices:
        assert result.results[idx] is not None
        assert isinstance(result.results[idx], ProcessedImageSet)

    # 無効インデックスは None
    for idx in invalid_indices:
        assert result.results[idx] is None

    # エラーは無効インデックスと過不足なく一致し、BatchProcessError である
    error_indices = sorted(e.index for e in result.errors)
    assert error_indices == sorted(invalid_indices)
    for err in result.errors:
        assert isinstance(err, BatchProcessError)
        assert err.source_path == source_paths[err.index]
        assert err.message  # 日本語メッセージが空でないこと

    # 成功数 + エラー数 = 入力数
    success_count = sum(1 for r in result.results if r is not None)
    assert success_count + len(result.errors) == len(source_paths)

    # 途中の失敗が後続の有効画像の成功を妨げない:
    # 最初の無効インデックスより後ろにある有効インデックスも成功していること
    if invalid_indices and valid_indices:
        first_invalid = min(invalid_indices)
        later_valid = [i for i in valid_indices if i > first_invalid]
        for idx in later_valid:
            assert result.results[idx] is not None
