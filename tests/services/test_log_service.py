"""
LogService のプロパティベーステスト

Property 17: ログローテーションの上限保証（要件 7.3）
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.services.log_service import LogService


def _make_log_service(tmp_dir: Path, cap_bytes: int) -> LogService:
    """テスト用に合計サイズ上限を小さく差し替えた LogService を生成する。

    MAX_TOTAL_BYTES はクラス属性だが、インスタンス属性で上書きすることで
    テストを高速に保ちつつ本番と同じローテーションロジックを検証できる。
    """
    service = LogService(log_dir=tmp_dir)
    service.MAX_TOTAL_BYTES = cap_bytes
    return service


def _write_log_files(tmp_dir: Path, sizes: list[int]) -> list[Path]:
    """指定サイズのログファイル群を古い順（ファイル名順）に作成する。

    LogService._sorted_log_files() はファイル名の昇順で古い順を判定するため、
    連番でゼロ埋めした名前を付けて作成順＝古い順を保証する。
    戻り値は作成したファイルパス（古い順）。
    """
    files: list[Path] = []
    for i, size in enumerate(sizes):
        path = tmp_dir / f"app_{i:04d}.jsonl"
        path.write_bytes(b"x" * size)
        files.append(path)
    return files


# Feature: line-stamp-generator, Property 17: ログローテーション後の合計サイズは常に上限以下
@given(
    sizes=st.lists(st.integers(min_value=0, max_value=5000), min_size=1, max_size=40),
    cap=st.integers(min_value=1000, max_value=20000),
)
@settings(max_examples=100)
def test_rotate_keeps_total_under_cap(sizes: list[int], cap: int) -> None:
    """rotate_if_needed 実行後、ログファイルの合計サイズは常に上限以下になる。

    **Validates: Requirements 7.3**
    """
    # 生成例ごとに独立した一時ディレクトリを使う（例間でファイルが混ざらないように）
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        service = _make_log_service(tmp_dir, cap_bytes=cap)
        _write_log_files(tmp_dir, sizes)

        service.rotate_if_needed()

        remaining = list(tmp_dir.glob("*.jsonl"))
        total = sum(p.stat().st_size for p in remaining)
        assert total <= cap


# Feature: line-stamp-generator, Property 17: ローテーションは最古ファイルから削除する
@given(
    sizes=st.lists(st.integers(min_value=1, max_value=5000), min_size=1, max_size=40),
    cap=st.integers(min_value=1000, max_value=20000),
)
@settings(max_examples=100)
def test_rotate_deletes_oldest_first(sizes: list[int], cap: int) -> None:
    """削除は最古のファイルから順に行われ、残るファイルは連続した新しい側の集合になる。

    **Validates: Requirements 7.3**
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        created = _write_log_files(tmp_dir, sizes)  # 古い順
        service = _make_log_service(tmp_dir, cap_bytes=cap)

        service.rotate_if_needed()

        remaining = sorted(tmp_dir.glob("*.jsonl"))
        remaining_names = {p.name for p in remaining}

        # 残ったファイルは元のリストの「末尾（新しい側）」の連続部分集合であること。
        # つまり、あるファイルが残っているなら、それより新しい全ファイルも残っている。
        deleted_flags = [c.name not in remaining_names for c in created]
        # 削除されたファイルはリストの先頭側に連続している（True が先、False が後）
        seen_kept = False
        for is_deleted in deleted_flags:
            if not is_deleted:
                seen_kept = True
            elif seen_kept:
                # 一度残したファイルの後にさらに古いファイルが削除されていたら NG
                raise AssertionError("最古以外のファイルが先に削除された")


# ---------------------------------------------------------------------------
# Property 16: ログエントリのフォーマット
# ---------------------------------------------------------------------------

import json
from datetime import datetime

from backend.services.log_service import LogLevel


def _is_iso8601(value: str) -> bool:
    """value が ISO 8601 形式としてパース可能かを判定する。"""
    try:
        datetime.fromisoformat(value)
        return True
    except ValueError:
        return False


def _read_all_entries(log_dir: Path) -> list[dict]:
    """log_dir 配下の全 .jsonl ファイルから全エントリ（dict）を読み込む。

    LogService は各エントリを `\\n` 区切りで書き込むため、ここでも `\\n` のみで
    分割する。str.splitlines() は U+0085 等の Unicode 改行文字でも分割してしまい、
    メッセージ中にそれらが含まれると 1 行の JSON を誤って分断するため使用しない。
    """
    entries: list[dict] = []
    for log_file in sorted(log_dir.glob("*.jsonl")):
        for line in log_file.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                entries.append(json.loads(line))
    return entries


# Feature: line-stamp-generator, Property 16: ログエントリのフォーマット
@given(
    level=st.sampled_from(list(LogLevel)),
    module=st.text(min_size=1, max_size=50),
    message=st.text(max_size=500),
)
@settings(max_examples=100)
def test_log_entry_format(tmp_path_factory, level, module, message) -> None:
    """任意の (level, module, message) の組み合わせに対して、
    LogService.log() が書き込むエントリには ISO 8601 タイムスタンプ・
    ログレベル (INFO/WARN/ERROR)・モジュール名・メッセージが含まれる。

    **Validates: Requirements 7.2**
    """
    # 各サンプルごとに独立した一時ログディレクトリを使用する（session スコープの
    # tmp_path_factory を使い、実ディスクの ~/.line-stamp-gen/logs/ には書き込まない）
    log_dir = tmp_path_factory.mktemp("logs")
    service = LogService(log_dir=log_dir)

    service.log(level, module, message)

    entries = _read_all_entries(log_dir)
    # ちょうど 1 件のエントリが書き込まれている
    assert len(entries) == 1
    entry = entries[0]

    # 4 つの必須フィールドが存在する
    assert set(entry.keys()) >= {"timestamp", "level", "module", "message"}

    # timestamp は ISO 8601 形式
    assert isinstance(entry["timestamp"], str)
    assert _is_iso8601(entry["timestamp"])

    # level は INFO/WARN/ERROR のいずれか、かつ入力値と一致する
    assert entry["level"] in {"INFO", "WARN", "ERROR"}
    assert entry["level"] == level.value

    # module / message は入力値がそのまま保持される
    assert entry["module"] == module
    assert entry["message"] == message
