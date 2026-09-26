/**
 * LogViewer のユニットテスト（Vitest + @testing-library/react）
 *
 * 対象: src/components/LogViewer.tsx
 * 要件: 7.4（表示件数の上限 1000 件）, 7.6（レベル・日付範囲フィルタ）
 *
 * 検証内容:
 * - レベルフィルタ / 日付範囲フィルタで表示行が絞り込まれること
 * - フィルタ操作時に onFilterChange が更新後のフィルタで呼ばれること
 * - 1000 件表示上限（>1000 件でも 1000 行のみ描画）
 * - 各行にタイムスタンプ・レベル・モジュール・メッセージが表示されること
 * - 純粋関数 filterAndCapEntries のフィルタ・上限の正しさ
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import LogViewer, {
  filterAndCapEntries,
  MAX_DISPLAY_ENTRIES,
  EMPTY_LOG_FILTER,
  type LogFilter,
} from "../components/LogViewer";
import type { LogEntry } from "../types/index";

/** テスト用のログエントリを生成するヘルパー */
function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: "2024-01-01T00:00:00.000Z",
    level: "INFO",
    module: "test_module",
    message: "テストメッセージ",
    ...overrides,
  };
}

/** ヘッダー行を除いたデータ行（tbody 内の row）を取得する */
function getDataRows(): HTMLElement[] {
  const rowgroups = screen.getAllByRole("rowgroup"); // [thead, tbody]
  const tbody = rowgroups[rowgroups.length - 1];
  return within(tbody).getAllByRole("row");
}

const SAMPLE_ENTRIES: LogEntry[] = [
  makeEntry({
    timestamp: "2024-01-01T09:00:00.000Z",
    level: "INFO",
    module: "config_service",
    message: "設定を読み込みました",
  }),
  makeEntry({
    timestamp: "2024-01-02T09:00:00.000Z",
    level: "WARN",
    module: "image_processor_service",
    message: "画像サイズが上限に近づいています",
  }),
  makeEntry({
    timestamp: "2024-01-03T09:00:00.000Z",
    level: "ERROR",
    module: "uploader_service",
    message: "アップロードに失敗しました",
  }),
];

describe("LogViewer コンポーネント", () => {
  describe("表示内容", () => {
    it("各行にタイムスタンプ・レベル・モジュール・メッセージを表示する", () => {
      render(<LogViewer entries={SAMPLE_ENTRIES} />);

      const rows = getDataRows();
      expect(rows).toHaveLength(3);

      // 1 行目の中身を検証
      const firstCells = within(rows[0]).getAllByRole("cell");
      expect(firstCells[0]).toHaveTextContent("2024-01-01T09:00:00.000Z");
      expect(firstCells[1]).toHaveTextContent("INFO");
      expect(firstCells[2]).toHaveTextContent("config_service");
      expect(firstCells[3]).toHaveTextContent("設定を読み込みました");

      // 他行のメッセージも表示されている
      expect(screen.getByText("画像サイズが上限に近づいています")).toBeInTheDocument();
      expect(screen.getByText("アップロードに失敗しました")).toBeInTheDocument();
    });

    it("エントリが空のとき日本語の空メッセージを表示する", () => {
      render(<LogViewer entries={[]} />);
      expect(screen.getByText("表示できるログがありません。")).toBeInTheDocument();
    });
  });

  describe("レベルフィルタ（要件 7.6）", () => {
    it("レベルを選ぶと該当レベルの行のみ表示され、onFilterChange が発火する", () => {
      const onFilterChange = vi.fn();
      render(
        <LogViewer entries={SAMPLE_ENTRIES} onFilterChange={onFilterChange} />,
      );

      const select = screen.getByLabelText("ログレベル");
      fireEvent.change(select, { target: { value: "ERROR" } });

      // 更新後のフィルタで onFilterChange が呼ばれる
      expect(onFilterChange).toHaveBeenCalledWith({
        ...EMPTY_LOG_FILTER,
        level: "ERROR",
      });

      // 表示行は ERROR の 1 件のみ
      const rows = getDataRows();
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("ERROR")).toBeInTheDocument();
      expect(
        within(rows[0]).getByText("アップロードに失敗しました"),
      ).toBeInTheDocument();
    });

    it("\"すべて\" のときは全レベルの行を表示する", () => {
      render(<LogViewer entries={SAMPLE_ENTRIES} />);
      expect(getDataRows()).toHaveLength(3);
    });
  });

  describe("日付範囲フィルタ（要件 7.6）", () => {
    it("開始日時を変更すると onFilterChange が発火し範囲外の行が除外される", () => {
      const onFilterChange = vi.fn();
      render(
        <LogViewer entries={SAMPLE_ENTRIES} onFilterChange={onFilterChange} />,
      );

      // 2024-01-02 以降のみ残す
      const dateFrom = screen.getByLabelText("開始日時");
      fireEvent.change(dateFrom, { target: { value: "2024-01-02T00:00" } });

      expect(onFilterChange).toHaveBeenCalledWith({
        ...EMPTY_LOG_FILTER,
        dateFrom: "2024-01-02T00:00",
      });

      // 01-02（WARN）と 01-03（ERROR）の 2 件が残る
      const rows = getDataRows();
      expect(rows).toHaveLength(2);
      expect(screen.queryByText("設定を読み込みました")).not.toBeInTheDocument();
    });

    it("終了日時を変更すると onFilterChange が発火し範囲外の行が除外される", () => {
      const onFilterChange = vi.fn();
      render(
        <LogViewer entries={SAMPLE_ENTRIES} onFilterChange={onFilterChange} />,
      );

      // 2024-01-02 まで（両端含む）
      const dateTo = screen.getByLabelText("終了日時");
      fireEvent.change(dateTo, { target: { value: "2024-01-02T23:59" } });

      expect(onFilterChange).toHaveBeenCalledWith({
        ...EMPTY_LOG_FILTER,
        dateTo: "2024-01-02T23:59",
      });

      // 01-01 と 01-02 の 2 件が残る
      const rows = getDataRows();
      expect(rows).toHaveLength(2);
      expect(screen.queryByText("アップロードに失敗しました")).not.toBeInTheDocument();
    });
  });

  describe("表示件数の上限（要件 7.4）", () => {
    it("1000 件を超えるエントリを渡しても 1000 行しか描画しない", () => {
      const many: LogEntry[] = Array.from({ length: 1001 }, (_, i) =>
        makeEntry({
          timestamp: `2024-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
          message: `メッセージ ${i}`,
        }),
      );

      render(<LogViewer entries={many} />);

      const rows = getDataRows();
      expect(rows.length).toBe(MAX_DISPLAY_ENTRIES);
      expect(rows.length).toBeLessThanOrEqual(1000);

      // 上限超過の案内（日本語）が表示される
      expect(
        screen.getByText(`最大 ${MAX_DISPLAY_ENTRIES} 件まで表示します`, {
          exact: false,
        }),
      ).toBeInTheDocument();
    });
  });
});

describe("filterAndCapEntries（純粋関数）", () => {
  beforeEach(() => {
    // 純粋関数のため状態リセットは不要だが、明示のため保持
  });

  it("level が \"all\" のとき全件を返す", () => {
    const result = filterAndCapEntries(SAMPLE_ENTRIES, EMPTY_LOG_FILTER);
    expect(result).toHaveLength(3);
  });

  it("level を指定するとそのレベルのみ残す", () => {
    const filter: LogFilter = { ...EMPTY_LOG_FILTER, level: "WARN" };
    const result = filterAndCapEntries(SAMPLE_ENTRIES, filter);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("WARN");
  });

  it("日付範囲で両端を含めて絞り込む", () => {
    const filter: LogFilter = {
      ...EMPTY_LOG_FILTER,
      dateFrom: "2024-01-02T00:00:00.000Z",
      dateTo: "2024-01-02T23:59:59.000Z",
    };
    const result = filterAndCapEntries(SAMPLE_ENTRIES, filter);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe("2024-01-02T09:00:00.000Z");
  });

  it("日付範囲指定時、パース不能なタイムスタンプのエントリは除外する", () => {
    const withBad = [
      ...SAMPLE_ENTRIES,
      makeEntry({ timestamp: "invalid-timestamp", message: "壊れたログ" }),
    ];
    const filter: LogFilter = {
      ...EMPTY_LOG_FILTER,
      dateFrom: "2024-01-01T00:00:00.000Z",
    };
    const result = filterAndCapEntries(withBad, filter);
    expect(result.every((e) => e.timestamp !== "invalid-timestamp")).toBe(true);
  });

  it("返却件数は maxEntries を超えない（上限の適用）", () => {
    const many: LogEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ message: `m${i}` }),
    );
    const result = filterAndCapEntries(many, EMPTY_LOG_FILTER, 3);
    expect(result).toHaveLength(3);
  });

  it("既定の上限は MAX_DISPLAY_ENTRIES（1000）", () => {
    const many: LogEntry[] = Array.from({ length: 1001 }, (_, i) =>
      makeEntry({ message: `m${i}` }),
    );
    const result = filterAndCapEntries(many, EMPTY_LOG_FILTER);
    expect(result).toHaveLength(MAX_DISPLAY_ENTRIES);
  });
});
