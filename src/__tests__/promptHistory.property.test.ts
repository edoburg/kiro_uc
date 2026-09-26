/**
 * プロンプト履歴 FIFO 管理のプロパティテスト（Property 3 / タスク 11.2）
 *
 * 対象: src/stores/promptHistoryStore.ts の純粋関数 addToHistory
 * Validates: Requirements 1.7
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  addToHistory,
  MAX_HISTORY,
} from "../stores/promptHistoryStore";
import type { PromptHistory } from "../types/index";

/** テスト用の PromptHistory エントリを生成する arbitrary（id は一意にするため index を付与） */
function entryArbitrary(): fc.Arbitrary<Omit<PromptHistory, "id">> {
  return fc.record({
    text: fc.string(),
    createdAt: fc.date().map((d) => d.toISOString()),
  });
}

/** 追加順のエントリ列を生成し、id を index で一意化する */
function distinctEntriesArbitrary(): fc.Arbitrary<PromptHistory[]> {
  return fc
    .array(entryArbitrary(), { minLength: 0, maxLength: 60 })
    .map((partials) =>
      partials.map((p, i) => ({ id: `entry-${i}`, text: p.text, createdAt: p.createdAt }))
    );
}

/**
 * addToHistory を追加順の列に対して畳み込み、最終的な履歴を得る。
 * entries[0] が最初に追加されるエントリとみなす。
 */
function foldHistory(addedInOrder: PromptHistory[]): PromptHistory[] {
  return addedInOrder.reduce<PromptHistory[]>(
    (acc, entry) => addToHistory(acc, entry),
    []
  );
}

describe("promptHistoryStore.addToHistory プロパティ", () => {
  // Feature: line-stamp-generator, Property 3: プロンプト履歴の FIFO 管理（最大20件・新しい順・最古を削除）
  it("Property 3: 任意の追加列に対し、常に MAX_HISTORY 件以下で新しい順、超過時は最古を削除する", () => {
    fc.assert(
      fc.property(distinctEntriesArbitrary(), (addedInOrder) => {
        const history = foldHistory(addedInOrder);

        // 1) 長さは常に MAX_HISTORY 件以下
        expect(history.length).toBeLessThanOrEqual(MAX_HISTORY);

        // 2) 追加総数が MAX_HISTORY 未満なら全件保持、以上なら MAX_HISTORY 件
        const expectedLength = Math.min(addedInOrder.length, MAX_HISTORY);
        expect(history.length).toBe(expectedLength);

        // 3) 新しい順（最後に追加したものが index 0）＝
        //    保持される集合は「最後に追加した min(N, 20) 件を逆順にしたもの」
        const kept = addedInOrder.slice(addedInOrder.length - expectedLength);
        const expected = [...kept].reverse();
        expect(history).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: line-stamp-generator, Property 3: プロンプト履歴の FIFO 管理（単一追加の先頭挿入とキャップ）
  it("Property 3: 既存履歴への単一追加でも新規が先頭に来て MAX_HISTORY 件以下を保つ", () => {
    fc.assert(
      fc.property(
        distinctEntriesArbitrary(),
        fc.record({ text: fc.string(), createdAt: fc.date().map((d) => d.toISOString()) }),
        (existingInOrder, newPartial) => {
          const existing = foldHistory(existingInOrder);
          const newEntry: PromptHistory = { id: "new-entry", ...newPartial };

          const result = addToHistory(existing, newEntry);

          // 新規が必ず先頭
          expect(result[0]).toEqual(newEntry);
          // 上限を超えない
          expect(result.length).toBeLessThanOrEqual(MAX_HISTORY);
          // 先頭を除いた部分は、追加前履歴の先頭 (MAX_HISTORY - 1) 件と一致
          expect(result.slice(1)).toEqual(existing.slice(0, MAX_HISTORY - 1));
        }
      ),
      { numRuns: 100 }
    );
  });
});
