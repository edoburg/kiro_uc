/**
 * ImagePreviewGrid プロパティテスト
 * タスク 12.2: プレビュー承認モードの残り枚数（n − 1）
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { remainingCountForApproval } from "../components/ImagePreviewGrid";
import type { StampCount } from "../types/index";

// LINE 規格の有効なスタンプ枚数（8/16/24/32/40）
const VALID_STAMP_COUNTS: StampCount[] = [8, 16, 24, 32, 40];

describe("remainingCountForApproval", () => {
  // Feature: line-stamp-generator, Property 4: プレビュー承認モードの残り枚数（n − 1）
  it("有効な StampCount では残り枚数が n - 1 になる（Validates: Requirements 2.3）", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_STAMP_COUNTS), (count) => {
        expect(remainingCountForApproval(count)).toBe(count - 1);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: line-stamp-generator, Property 4: プレビュー承認モードの残り枚数（n − 1）
  it("1 以上の整数では残り枚数が n - 1 になる（Validates: Requirements 2.3）", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (n) => {
        expect(remainingCountForApproval(n)).toBe(n - 1);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: line-stamp-generator, Property 4: プレビュー承認モードの残り枚数（n − 1）
  it("0 以下では 0 に丸められる（Math.max(0, n-1)）（Validates: Requirements 2.3）", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100000, max: 0 }), (n) => {
        expect(remainingCountForApproval(n)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: line-stamp-generator, Property 4: プレビュー承認モードの残り枚数（n − 1）
  it("任意の整数で Math.max(0, n - 1) と一致する（Validates: Requirements 2.3）", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(remainingCountForApproval(n)).toBe(Math.max(0, n - 1));
      }),
      { numRuns: 100 },
    );
  });
});
