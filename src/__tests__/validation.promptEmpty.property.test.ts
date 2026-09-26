/**
 * validatePrompt 空白・空文字拒否のプロパティテスト
 *
 * タスク 10.3 / Property 2 対象。
 * Vitest + fast-check（最低 100 イテレーション）。
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validatePrompt } from "../utils/validation";

// JS String.prototype.trim() が空白として扱う文字。
// 半角スペース・タブ・改行・復帰・垂直タブ・改ページ・ノーブレークスペース・全角スペース(U+3000)を含む。
const WHITESPACE_CHARS = [
  " ", // 半角スペース U+0020
  "\t", // タブ U+0009
  "\n", // 改行 U+000A
  "\r", // 復帰 U+000D
  "\v", // 垂直タブ U+000B
  "\f", // 改ページ U+000C
  "\u00A0", // ノーブレークスペース
  "\u3000", // 全角スペース
];

describe("validatePrompt - Property 2: 空白・空文字プロンプトの拒否", () => {
  // Feature: line-stamp-generator, Property 2: 空白・空文字プロンプトは「条件を入力してください」で拒否される
  it("空文字・空白のみの文字列は必ず「条件を入力してください」で拒否される（100回以上）", () => {
    // **Validates: Requirements 1.3**
    const whitespaceOnly = fc
      .array(fc.constantFrom(...WHITESPACE_CHARS), { minLength: 0, maxLength: 50 })
      .map((chars) => chars.join(""));

    fc.assert(
      fc.property(whitespaceOnly, (text) => {
        const result = validatePrompt(text);
        expect(result).not.toBeNull();
        expect(result?.field).toBe("prompt");
        expect(result?.message).toBe("条件を入力してください");
      }),
      { numRuns: 100 }
    );
  });

  // Feature: line-stamp-generator, Property 2: 非空白を含む文字列は「空」を理由に拒否されない
  it("非空白文字を含む文字列は「条件を入力してください」では拒否されない（100回以上）", () => {
    // **Validates: Requirements 1.3**
    // 非空白文字を最低 1 文字含み、長さ制限（1000 文字）内に収まる文字列を生成する。
    const nonWhitespaceContent = fc
      .string({ minLength: 1, maxLength: 200 })
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(nonWhitespaceContent, (text) => {
        const result = validatePrompt(text);
        // 空を理由としたエラーメッセージは返されない。
        expect(result?.message).not.toBe("条件を入力してください");
      }),
      { numRuns: 100 }
    );
  });
});
