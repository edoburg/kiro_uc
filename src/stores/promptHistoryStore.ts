/**
 * プロンプト履歴ストア
 *
 * 要件:
 * - 1.7: Prompt 送信時にテキストを履歴として保存し、最大 20 件まで新しい順で保持する
 *   （20 件超過時は最古の 1 件を削除する）
 * - 1.8: 履歴から特定の Prompt を選択すると、そのテキストを入力フォームへ反映する
 */

import { create } from "zustand";
import type { PromptHistory } from "../types/index";

/** 履歴の最大保持件数 */
export const MAX_HISTORY = 20;

/**
 * 履歴リストへ新しいエントリを先頭に追加し、最大件数で打ち切る純粋関数。
 *
 * - 新しいものが先頭（新しい順）
 * - 常に MAX_HISTORY 件以下
 * - 上限超過時は最古（末尾）から削除する（FIFO キャップ）
 *
 * 副作用を持たない純粋関数として実装し、Property 3（タスク 11.2）の
 * プロパティテスト対象とする。
 */
export function addToHistory(
  entries: PromptHistory[],
  newEntry: PromptHistory
): PromptHistory[] {
  return [newEntry, ...entries].slice(0, MAX_HISTORY);
}

/** 新しい履歴エントリを生成する（ID・作成日時を付与） */
function createEntry(text: string): PromptHistory {
  return {
    id: crypto.randomUUID(),
    text,
    createdAt: new Date().toISOString(),
  };
}

interface PromptHistoryState {
  /** 履歴一覧（新しい順、最大 20 件） */
  entries: PromptHistory[];
  /** プロンプトテキストを履歴へ追加する（要件 1.7） */
  add: (text: string) => void;
  /** 全履歴を取得する */
  getAll: () => PromptHistory[];
  /**
   * 履歴 ID を指定して選択し、そのテキストをコールバックへ渡す（要件 1.8）。
   * コールバックは入力フォームへの反映に用いる。
   * 該当 ID が存在しない場合はコールバックを呼び出さず undefined を返す。
   */
  select: (id: string, onSelect: (text: string) => void) => string | undefined;
  /** 全履歴をクリアする */
  clear: () => void;
}

export const usePromptHistoryStore = create<PromptHistoryState>((set, get) => ({
  entries: [],

  add: (text: string) => {
    set((state) => ({
      entries: addToHistory(state.entries, createEntry(text)),
    }));
  },

  getAll: () => get().entries,

  select: (id: string, onSelect: (text: string) => void) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) {
      return undefined;
    }
    onSelect(entry.text);
    return entry.text;
  },

  clear: () => set({ entries: [] }),
}));
