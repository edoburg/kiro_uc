"""
LogService — ローテーション付きファイルロガー

ログファイルの保存先: ~/.line-stamp-gen/logs/
各ファイルは JSONL 形式（1行 = 1 LogEntry）。
合計サイズが 100MB を超えた時点で最古ファイルから削除する。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

from backend.models import LogEntry


class LogLevel(str, Enum):
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"


class LogService:
    MAX_TOTAL_BYTES = 100 * 1024 * 1024  # 100 MB
    MAX_DISPLAY_ENTRIES = 1000

    # 1ファイルあたりの上限は 10MB（ローテーション粒度）
    _MAX_FILE_BYTES = 10 * 1024 * 1024

    def __init__(self, log_dir: Optional[Path] = None) -> None:
        if log_dir is None:
            log_dir = Path.home() / ".line-stamp-gen" / "logs"
        self._log_dir = log_dir
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._current_file: Optional[Path] = None

    # ------------------------------------------------------------------
    # パブリック API
    # ------------------------------------------------------------------

    def log(self, level: LogLevel, module: str, message: str) -> None:
        """ログエントリを現在のログファイルへ追記する。
        書き込みに失敗してもアプリをクラッシュさせない（要件 7.5）。
        """
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level.value if isinstance(level, LogLevel) else str(level),
            module=module,
            message=message,
        )
        try:
            log_file = self._current_log_file()
            with log_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(self._entry_to_dict(entry), ensure_ascii=False) + "\n")
            self.rotate_if_needed()
        except Exception:
            # 要件 7.5: ログ書き込みエラーで主要機能を停止させない
            pass

    def rotate_if_needed(self) -> None:
        """全ログファイルの合計サイズが 100MB を超えた場合、
        最古のファイルから順に合計が 100MB 以下になるまで削除する（要件 7.3）。
        """
        log_files = self._sorted_log_files()
        while self._total_size(log_files) > self.MAX_TOTAL_BYTES and log_files:
            oldest = log_files.pop(0)
            try:
                oldest.unlink()
            except OSError:
                pass

    def get_entries(
        self,
        level: Optional[LogLevel] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        limit: int = 1000,
    ) -> list[LogEntry]:
        """ログエントリをフィルタして返す。

        - level: 指定した LogLevel のエントリのみ返す
        - date_from / date_to: タイムスタンプによる日付範囲フィルタ（両端含む）
        - limit: 返す最大件数（デフォルト 1000、要件 7.4）
        """
        limit = min(limit, self.MAX_DISPLAY_ENTRIES)
        entries: list[LogEntry] = []

        # 最新ファイルから読み込み、上限に達したら早期終了
        for log_file in reversed(self._sorted_log_files()):
            if len(entries) >= limit:
                break
            try:
                lines = log_file.read_text(encoding="utf-8").splitlines()
            except OSError:
                continue
            # 最新行から取得するため逆順で処理
            for line in reversed(lines):
                if not line.strip():
                    continue
                entry = self._parse_line(line)
                if entry is None:
                    continue
                if not self._matches_filter(entry, level, date_from, date_to):
                    continue
                entries.append(entry)
                if len(entries) >= limit:
                    break

        # 新しい順（ファイル・行とも逆順に読んだので結果は新しい順になっている）
        return entries

    # ------------------------------------------------------------------
    # 内部ヘルパー
    # ------------------------------------------------------------------

    def _current_log_file(self) -> Path:
        """アクティブなログファイルのパスを返す。
        ファイルが存在しないか _MAX_FILE_BYTES を超えていれば新規作成する。
        """
        if self._current_file is None or not self._current_file.exists():
            self._current_file = self._new_log_file_path()
        elif self._current_file.stat().st_size >= self._MAX_FILE_BYTES:
            self._current_file = self._new_log_file_path()
        return self._current_file

    def _new_log_file_path(self) -> Path:
        """タイムスタンプベースのログファイルパスを生成する。"""
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        return self._log_dir / f"app_{ts}.jsonl"

    def _sorted_log_files(self) -> list[Path]:
        """ログディレクトリ内の .jsonl ファイルを古い順に返す。"""
        return sorted(self._log_dir.glob("*.jsonl"))

    def _total_size(self, files: list[Path]) -> int:
        """ファイルリストの合計サイズ（バイト）を返す。"""
        total = 0
        for f in files:
            try:
                total += f.stat().st_size
            except OSError:
                pass
        return total

    @staticmethod
    def _entry_to_dict(entry: LogEntry) -> dict:
        return {
            "timestamp": entry.timestamp,
            "level": entry.level,
            "module": entry.module,
            "message": entry.message,
        }

    @staticmethod
    def _parse_line(line: str) -> Optional[LogEntry]:
        """JSON 行を LogEntry に変換する。パース失敗時は None を返す。"""
        try:
            data = json.loads(line)
            return LogEntry(
                timestamp=data["timestamp"],
                level=data["level"],
                module=data["module"],
                message=data["message"],
            )
        except (json.JSONDecodeError, KeyError):
            return None

    @staticmethod
    def _matches_filter(
        entry: LogEntry,
        level: Optional[LogLevel],
        date_from: Optional[datetime],
        date_to: Optional[datetime],
    ) -> bool:
        """エントリがフィルタ条件を満たすか確認する（要件 7.6）。"""
        if level is not None and entry.level != level.value:
            return False
        if date_from is not None or date_to is not None:
            try:
                ts = datetime.fromisoformat(entry.timestamp)
                # タイムゾーン情報がなければ UTC として扱う
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if date_from is not None:
                    df = date_from if date_from.tzinfo else date_from.replace(tzinfo=timezone.utc)
                    if ts < df:
                        return False
                if date_to is not None:
                    dt = date_to if date_to.tzinfo else date_to.replace(tzinfo=timezone.utc)
                    if ts > dt:
                        return False
            except ValueError:
                return False
        return True
