/**
 * Property 1: プロンプト文字数バリデーション のプロパティベーステスト
 *
 * 対象関数: validatePromptLength / validatePrompt の文字数ルール
 * Validates: Requirements 1.2
 *
 * 実装（src/utils/validation.ts）は `.length`（UTF-16 コードユニット数）で
 * 1000 文字を境界に判定するため、テストもそれに合わせる。
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validatePromptLength, validatePrompt } from "../utils/validation";

const MAX_LENGTH = 1000;

/**
 * 指定した UTF-16 コードユニット長ちょうどの文字列を生成する。
 * BMP 内の 1 コードユニット文字のみを使うことで `.length` が length と一致する。
 */
function stringOfLength(length: number): fc.Arbitrary<string> {
  // 0x0021〜0xD7FF の範囲（サロゲートペアを避け 1 コードユニット文字に限定）
  return fc
    .array(fc.integer({ min: 0x0021, max: 0xd7ff }), {
      minLength: length,
      maxLength: length,
    })
    .map((codes) => codes.map((c) => String.fromCharCode(c)).join(""));
}

/** 0〜MAX_LENGTH 文字ちょうどの文字列（有効サイズ） */
const validLengthString: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: MAX_LENGTH })
  .chain((len) => stringOfLength(len));

/** MAX_LENGTH 超の文字列（無効サイズ） */
const overLengthString: fc.Arbitrary<string> = fc
  .integer({ min: MAX_LENGTH + 1, max: MAX_LENGTH + 500 })
  .chain((len) => stringOfLength(len));

/** 先頭に非空白文字を含む 1〜MAX_LENGTH 文字の文字列（trim 後も非空・有効サイズ） */
const nonBlankValidString: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: MAX_LENGTH })
  .chain((len) => stringOfLength(len - 1).map((rest) => "あ" + rest));

/** 先頭に非空白文字を含む MAX_LENGTH 超の文字列 */
const nonBlankOverLengthString: fc.Arbitrary<string> = fc
  .integer({ min: MAX_LENGTH + 1, max: MAX_LENGTH + 500 })
  .chain((len) => stringOfLength(len - 1).map((rest) => "あ" + rest));

describe("Property 1: プロンプト文字数バリデーション", () => {
  // Feature: line-stamp-generator, Property 1: 1000文字以下のプロンプトは有効（null）である
  it("1000文字以下のプロンプトは validatePromptLength で null を返す", () => {
    fc.assert(
      fc.property(validLengthString, (text) => {
        expect(text.length).toBeLessThanOrEqual(MAX_LENGTH);
        expect(validatePromptLength(text)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Feature: line-stamp-generator, Property 1: 1000文字超のプロンプトは無効（日本語メッセージ付き ValidationError）である
  it("1000文字超のプロンプトは validatePromptLength で日本語メッセージ付き ValidationError を返す", () => {
    fc.assert(
      fc.property(overLengthString, (text) => {
        expect(text.length).toBeGreaterThan(MAX_LENGTH);
        const result = validatePromptLength(text);
        expect(result).not.toBeNull();
        expect(result?.field).toBe("prompt");
        // 日本語メッセージであること（「文字以内」を含む）
        expect(result?.message).toContain("1000文字以内");
      }),
      { numRuns: 100 }
    );
  });

  // Feature: line-stamp-generator, Property 1: validatePrompt も同じ文字数ルールに従う（空白でない 1000 文字以下は null）
  it("validatePrompt: 空白でない1000文字以下のプロンプトは null を返す", () => {
    fc.assert(
      fc.property(nonBlankValidString, (text) => {
        expect(text.length).toBeLessThanOrEqual(MAX_LENGTH);
        expect(text.trim().length).toBeGreaterThan(0);
        expect(validatePrompt(text)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Feature: line-stamp-generator, Property 1: validatePrompt も 1000 文字超は無効
  it("validatePrompt: 1000文字超のプロンプトは日本語メッセージ付き ValidationError を返す", () => {
    fc.assert(
      fc.property(nonBlankOverLengthString, (text) => {
        expect(text.length).toBeGreaterThan(MAX_LENGTH);
        const result = validatePrompt(text);
        expect(result).not.toBeNull();
        expect(result?.field).toBe("prompt");
        expect(result?.message).toContain("1000文字以内");
      }),
      { numRuns: 100 }
    );
  });
});
