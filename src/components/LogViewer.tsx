import React, { useMemo, useState } from "react";
import type { LogEntry } from "../types/index";

/** 表示するログの最大件数（要件 7.4、design.md: LogService.MAX_DISPLAY_ENTRIES = 1000） */
export const MAX_DISPLAY_ENTRIES = 1000;

/** レベルフィルタの選択肢（"all" は全レベル表示） */
export type LogLevelFilter = "all" | LogEntry["level"];

/**
 * ログのフィルタ条件。
 * バックエンド GET /logs（level / date_from / date_to / limit）に対応する。
 * 日付は入力の扱いやすさを優先し ISO 8601 文字列（空文字は未指定）で保持する。
 */
export interface LogFilter {
  /** ログレベル（"all" は全件） */
  level: LogLevelFilter;
  /** 開始日時（ISO 8601、両端含む）。未指定は空文字。 */
  dateFrom: string;
  /** 終了日時（ISO 8601、両端含む）。未指定は空文字。 */
  dateTo: string;
}

/** フィルタの初期値（全レベル・日付範囲なし） */
export const EMPTY_LOG_FILTER: LogFilter = {
  level: "all",
  dateFrom: "",
  dateTo: "",
};

/** レベルフィルタの選択肢と日本語ラベル */
const LEVEL_OPTIONS: ReadonlyArray<{ value: LogLevelFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "INFO", label: "INFO（情報）" },
  { value: "WARN", label: "WARN（警告）" },
  { value: "ERROR", label: "ERROR（エラー）" },
];

export interface LogViewerProps {
  /**
   * 表示対象のログエントリ一覧。
   * design.md は LogViewer の Props を明示していないため、
   * バックエンドの LogService.get_entries() が返すエントリをそのまま受け取る契約とする。
   * 新しい順で渡される想定だが、順序に依存しない（フィルタ・上限のみ適用する）。
   */
  entries: LogEntry[];
  /**
   * フィルタ条件が変化したときに呼ばれるコールバック。
   * 親（もしくは IPC 経由のバックエンド）は必要に応じて
   * level / date_from / date_to を GET /logs へ渡して再取得できる。
   */
  onFilterChange?: (filter: LogFilter) => void;
  /**
   * 親が制御コンポーネントとして使う場合の現在のフィルタ値（省略可能）。
   * 省略時は本コンポーネント内部でフィルタ状態を保持する。
   */
  filter?: LogFilter;
}

/** 日時文字列を epoch ミリ秒に変換する。パース不能なら null。 */
function toEpochMillis(value: string): number | null {
  if (!value) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

/**
 * ログエントリにレベル・日付範囲フィルタを適用し、最大 MAX_DISPLAY_ENTRIES 件に制限する純粋関数。
 *
 * - level が "all" 以外の場合、その level のエントリのみ残す（要件 7.6）。
 * - dateFrom / dateTo が指定されていれば両端を含む範囲で絞り込む（要件 7.6）。
 *   パース不能なタイムスタンプを持つエントリは、日付範囲が指定されている場合は除外する。
 * - 返却件数は常に MAX_DISPLAY_ENTRIES 以下（要件 7.4）。
 *
 * 副作用を持たないため、ユニット／プロパティテストの対象にできる。
 */
export function filterAndCapEntries(
  entries: LogEntry[],
  filter: LogFilter,
  maxEntries: number = MAX_DISPLAY_ENTRIES,
): LogEntry[] {
  const fromMillis = toEpochMillis(filter.dateFrom);
  const toMillis = toEpochMillis(filter.dateTo);
  const hasDateRange = fromMillis !== null || toMillis !== null;

  const filtered = entries.filter((entry) => {
    if (filter.level !== "all" && entry.level !== filter.level) {
      return false;
    }
    if (hasDateRange) {
      const tsMillis = toEpochMillis(entry.timestamp);
      if (tsMillis === null) {
        return false;
      }
      if (fromMillis !== null && tsMillis < fromMillis) {
        return false;
      }
      if (toMillis !== null && tsMillis > toMillis) {
        return false;
      }
    }
    return true;
  });

  // 表示件数の上限（要件 7.4）
  return filtered.slice(0, Math.max(0, maxEntries));
}

/**
 * LogViewer
 *
 * アプリのログを一覧表示し、レベル・日付範囲でフィルタするコンポーネント（要件 7.4, 7.6）。
 *
 * - ログエントリを表（タイムスタンプ・レベル・モジュール・メッセージ）で表示する。
 * - レベルフィルタ（INFO / WARN / ERROR / すべて）を提供する。
 * - 日付範囲フィルタ（開始／終了）を提供する。
 * - 表示は最大 1000 件（要件 7.4）。
 *
 * フィルタは props.filter による制御（親制御）と内部状態のどちらにも対応する。
 * フィルタ変更時は onFilterChange を通じて親へ通知し、親はバックエンド再取得に利用できる。
 *
 * ユーザー向けテキストはすべて日本語。
 */
const LogViewer: React.FC<LogViewerProps> = ({ entries, onFilterChange, filter }) => {
  // 親が filter を渡さない場合は内部状態でフィルタを管理する
  const [internalFilter, setInternalFilter] = useState<LogFilter>(EMPTY_LOG_FILTER);
  const activeFilter = filter ?? internalFilter;

  const updateFilter = (next: LogFilter): void => {
    if (filter === undefined) {
      setInternalFilter(next);
    }
    onFilterChange?.(next);
  };

  // 表示対象（フィルタ適用済み・上限 1000 件、要件 7.4, 7.6）
  const displayedEntries = useMemo(
    () => filterAndCapEntries(entries, activeFilter),
    [entries, activeFilter],
  );

  // 上限超過で一部が省略されているか
  const isCapped = useMemo(() => {
    const totalMatched = filterAndCapEntries(
      entries,
      activeFilter,
      Number.MAX_SAFE_INTEGER,
    ).length;
    return totalMatched > displayedEntries.length;
  }, [entries, activeFilter, displayedEntries.length]);

  return (
    <section className="log-viewer" aria-label="ログビューア">
      <h2>ログ</h2>

      {/* --- フィルタ操作 --- */}
      <div className="log-viewer__filters">
        {/* レベルフィルタ（要件 7.6） */}
        <div className="log-viewer__filter-field">
          <label htmlFor="log-viewer-level">ログレベル</label>
          <select
            id="log-viewer-level"
            name="level"
            value={activeFilter.level}
            onChange={(e) =>
              updateFilter({
                ...activeFilter,
                level: e.target.value as LogLevelFilter,
              })
            }
          >
            {LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 日付範囲フィルタ（開始）（要件 7.6） */}
        <div className="log-viewer__filter-field">
          <label htmlFor="log-viewer-date-from">開始日時</label>
          <input
            id="log-viewer-date-from"
            name="dateFrom"
            type="datetime-local"
            value={activeFilter.dateFrom}
            onChange={(e) =>
              updateFilter({ ...activeFilter, dateFrom: e.target.value })
            }
          />
        </div>

        {/* 日付範囲フィルタ（終了）（要件 7.6） */}
        <div className="log-viewer__filter-field">
          <label htmlFor="log-viewer-date-to">終了日時</label>
          <input
            id="log-viewer-date-to"
            name="dateTo"
            type="datetime-local"
            value={activeFilter.dateTo}
            onChange={(e) =>
              updateFilter({ ...activeFilter, dateTo: e.target.value })
            }
          />
        </div>
      </div>

      {/* --- 表示件数の案内 --- */}
      <p className="log-viewer__count" role="status" aria-live="polite">
        {displayedEntries.length} 件を表示
        {isCapped && `（最大 ${MAX_DISPLAY_ENTRIES} 件まで表示します）`}
      </p>

      {/* --- ログ一覧 --- */}
      {displayedEntries.length === 0 ? (
        <p className="log-viewer__empty">表示できるログがありません。</p>
      ) : (
        <table className="log-viewer__table">
          <caption className="log-viewer__caption">
            条件に一致するログエントリの一覧
          </caption>
          <thead>
            <tr>
              <th scope="col">タイムスタンプ</th>
              <th scope="col">レベル</th>
              <th scope="col">モジュール</th>
              <th scope="col">メッセージ</th>
            </tr>
          </thead>
          <tbody>
            {displayedEntries.map((entry, index) => (
              <tr
                key={`${entry.timestamp}-${index}`}
                className={`log-viewer__row log-viewer__row--${entry.level.toLowerCase()}`}
              >
                <td>{entry.timestamp}</td>
                <td>
                  <span
                    className={`log-viewer__level log-viewer__level--${entry.level.toLowerCase()}`}
                  >
                    {entry.level}
                  </span>
                </td>
                <td>{entry.module}</td>
                <td>{entry.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

export default LogViewer;
