"""
LogService の表示件数上限プロパティテスト

Property 18: ログ表示件数の上限（要件 7.4）
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.services.log_service import LogService


def _write_entries(tmp_dir: Path, total: int, files: int) -> None:
    """total 件のログエントリを files 個の .jsonl ファイルに分割して書き込む。

    LogService.get_entries() は各行を 1 エントリとして解釈するため、ここでは
    LogService.log() を total 回呼ぶ代わりに JSONL 形式で直接書き込み、
    大量エントリでもテストを高速に保つ。ファイル名は昇順＝古い順になるよう
    ゼロ埋め連番を付ける。
    """
    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    written = 0
    # total 件を files 個のファイルにできるだけ均等に分配する
    per_file = max(1, (total + files - 1) // files)
    for fi in range(files):
        if written >= total:
            break
        path = tmp_dir / f"app_{fi:04d}.jsonl"
        lines: list[str] = []
        for _ in range(per_file):
            if written >= total:
                break
            entry = {
                "timestamp": (base + timedelta(seconds=written)).isoformat(),
                "level": "INFO",
                "module": "test",
                "message": f"msg-{written}",
            }
            lines.append(json.dumps(entry, ensure_ascii=False))
            written += 1
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# Feature: line-stamp-generator, Property 18: get_entries() は総件数によらず最大1000件までしか返さない
@given(
    total=st.integers(min_value=0, max_value=3000),
    files=st.integers(min_value=1, max_value=5),
    limit=st.integers(min_value=1, max_value=5000),
)
@settings(max_examples=100)
def test_get_entries_never_exceeds_display_cap(total: int, files: int, limit: int) -> None:
    """ログエントリが何件存在しても、get_entries() が返す件数は
    MAX_DISPLAY_ENTRIES（1000）以下、かつ要求 limit 以下、かつ実在件数以下になる。

    **Validates: Requirements 7.4**
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        _write_entries(tmp_dir, total=total, files=files)

        result = LogService(log_dir=tmp_dir).get_entries(limit=limit)

        # 表示上限（1000）を超えない
        assert len(result) <= LogService.MAX_DISPLAY_ENTRIES
        # 要求された limit と表示上限のうち小さい方を超えない
        assert len(result) <= min(limit, LogService.MAX_DISPLAY_ENTRIES)
        # 実在するエントリ数を超えない
        assert len(result) <= total
