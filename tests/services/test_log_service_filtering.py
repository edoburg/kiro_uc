"""
LogService.get_entries() のフィルタリング正確性を検証するプロパティテスト。

このファイルは並行編集の衝突を避けるため、tests/services/test_log_service.py とは
独立したファイルとして作成している（タスク 3.5）。

- pytest + Hypothesis（最低 100 イテレーション）
- 各 example ごとに tempfile.TemporaryDirectory() を用い、実際の
  ~/.line-stamp-gen/logs/ には書き込まない。
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from backend.models import LogEntry
from backend.services.log_service import LogLevel, LogService


# 生成対象のログレベル一覧
_LEVELS = [LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR]

# タイムスタンプ生成の基準となる固定の起点（UTC）
_EPOCH = datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc)


@st.composite
def _log_entries(draw: st.DrawFn) -> list[LogEntry]:
    """一意なタイムスタンプを持つ LogEntry のリストを生成する。

    各エントリのタイムスタンプが一意になるよう、起点からの経過秒数（オフセット）を
    重複なしで割り当てる。件数は get_entries の 1000 件上限より十分小さくする。
    """
    n = draw(st.integers(min_value=0, max_value=50))
    # 一意なオフセット（秒）を n 個選ぶ
    offsets = draw(
        st.lists(
            st.integers(min_value=0, max_value=100_000),
            min_size=n,
            max_size=n,
            unique=True,
        )
    )
    entries: list[LogEntry] = []
    for i, off in enumerate(offsets):
        level = draw(st.sampled_from(_LEVELS))
        ts = (_EPOCH + timedelta(seconds=off)).isoformat()
        entries.append(
            LogEntry(
                timestamp=ts,
                level=level.value,
                module=f"module_{i}",
                message=f"message_{i}",
            )
        )
    return entries


def _write_entries(log_dir: Path, entries: list[LogEntry]) -> None:
    """制御したタイムスタンプで LogEntry を JSONL ログファイルへ直接書き込む。

    LogService.log() は書き込み時刻を独自に付与するため、日付範囲フィルタの
    検証にはあらかじめタイムスタンプを固定したエントリをファイルへ書く必要がある。
    LogService._parse_line が読み取れる形式（1行 = 1 JSON）で出力する。
    """
    log_file = log_dir / "app_fixed.jsonl"
    with log_file.open("w", encoding="utf-8") as f:
        for e in entries:
            row = {
                "timestamp": e.timestamp,
                "level": e.level,
                "module": e.module,
                "message": e.message,
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _reference_filter(
    entries: list[LogEntry],
    level: LogLevel | None,
    date_from: datetime | None,
    date_to: datetime | None,
) -> set[tuple[str, str, str, str]]:
    """フィルタ条件を満たすべきエントリを純粋 Python で算出する参照実装。"""
    result: set[tuple[str, str, str, str]] = set()
    for e in entries:
        if level is not None and e.level != level.value:
            continue
        ts = datetime.fromisoformat(e.timestamp)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if date_from is not None and ts < date_from:
            continue
        if date_to is not None and ts > date_to:
            continue
        result.add(_entry_key(e))
    return result


def _entry_key(e: LogEntry) -> tuple[str, str, str, str]:
    return (e.timestamp, e.level, e.module, e.message)


# Feature: line-stamp-generator, Property 19: ログフィルタリングの正確性
# （level / 日付範囲フィルタは条件に一致するエントリだけを過不足なく返す）
@settings(max_examples=100, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    entries=_log_entries(),
    level=st.one_of(st.none(), st.sampled_from(_LEVELS)),
    from_offset=st.one_of(st.none(), st.integers(min_value=0, max_value=100_000)),
    to_offset=st.one_of(st.none(), st.integers(min_value=0, max_value=100_000)),
)
def test_get_entries_filtering_is_exact(entries, level, from_offset, to_offset):
    """
    **Validates: Requirements 7.6**

    LogService.get_entries() は level・日付範囲フィルタに完全に一致する
    エントリのみを返す（false positive も false negative もない）ことを検証する。
    """
    date_from = None if from_offset is None else _EPOCH + timedelta(seconds=from_offset)
    date_to = None if to_offset is None else _EPOCH + timedelta(seconds=to_offset)

    with tempfile.TemporaryDirectory() as tmp:
        log_dir = Path(tmp)
        _write_entries(log_dir, entries)
        service = LogService(log_dir=log_dir)

        # 期待集合（参照実装）。件数は上限 1000 未満なので limit の影響は受けない。
        expected = _reference_filter(entries, level, date_from, date_to)

        actual_entries = service.get_entries(
            level=level,
            date_from=date_from,
            date_to=date_to,
            limit=LogService.MAX_DISPLAY_ENTRIES,
        )
        actual = {_entry_key(e) for e in actual_entries}

        # 返却エントリに重複がない
        assert len(actual_entries) == len(actual)
        # false positive がない：返された全エントリはフィルタ条件を満たす
        assert actual <= expected, f"false positive: {actual - expected}"
        # false negative がない：条件を満たす全エントリが返る
        assert expected <= actual, f"false negative: {expected - actual}"
