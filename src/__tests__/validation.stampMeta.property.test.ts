/**
 * Property 9: Stamp_Set メタデータバリデーション
 *
 * validateTitle / validateDescription のプロパティテスト。
 * Validates: Requirements 4.2, 4.3
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateTitle, validateDescription } from "../utils/validation";

/**
 * 指定したコードユニット長の文字列を生成する Arbitrary。
 * サロゲートペア（複数コードユニット）を避けるため、BMP 内の
 * 単一コードユニット文字のみを使用する。
 */
function bmpStringOfLength(length: number): fc.Arbitrary<string> {
  // U+0021〜U+D7FF の範囲はすべて単一 UTF-16 コードユニット。
  const singleUnitChar = fc
    .integer({ min: 0x21, max: 0xd7ff })
    .map((code) => String.fromCharCode(code));
  return fc
    .array(singleUnitChar, { minLength: length, maxLength: length })
    .map((chars) => chars.join(""));
}

/** 指定した長さレンジ内で、その長さちょうどの BMP 文字列を生成する。 */
function bmpStringInLengthRange(
  min: number,
  max: number
): fc.Arbitrary<string> {
  return fc.integer({ min, max }).chain((len) => bmpStringOfLength(len));
}

// ---------------------------------------------------------------------------
// validateTitle
// ---------------------------------------------------------------------------

describe("Property 9: validateTitle", () => {
  // Feature: line-stamp-generator, Property 9: 1〜40文字のタイトルは有効（null を返す）
  it("1〜40文字のタイトルは null を返す", () => {
    fc.assert(
      fc.property(bmpStringInLengthRange(1, 40), (title) => {
        expect(title.length).toBeGreaterThanOrEqual(1);
        expect(title.length).toBeLessThanOrEqual(40);
        expect(validateTitle(title)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Feature: line-stamp-generator, Property 9: 0文字または40文字超のタイトルは無効（field 'title'、日本語メッセージ）
  it("0文字または41文字以上のタイトルは ValidationError を返す", () => {
    const invalidTitle = fc.oneof(
      bmpStringOfLength(0),
      bmpStringInLengthRange(41, 200)
    );
    fc.assert(
      fc.property(invalidTitle, (title) => {
        expect(title.length === 0 || title.length > 40).toBe(true);
        const result = validateTitle(title);
        expect(result).not.toBeNull();
        expect(result?.field).toBe("title");
        // 日本語メッセージであること（ひらがな・カタカナ・漢字を含む）
        expect(result!.message.length).toBeGreaterThan(0);
        expect(/[ぁ-んァ-ヶ一-龠々]/.test(result!.message)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// validateDescription
// ---------------------------------------------------------------------------

describe("Property 9: validateDescription", () => {
  // Feature: line-stamp-generator, Property 9: 0〜160文字の説明は有効（null を返す）
  it("0〜160文字の説明は null を返す", () => {
    fc.assert(
      fc.property(bmpStringInLengthRange(0, 160), (desc) => {
        expect(desc.length).toBeGreaterThanOrEqual(0);
        expect(desc.length).toBeLessThanOrEqual(160);
        expect(validateDescription(desc)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Feature: line-stamp-generator, Property 9: 160文字超の説明は無効（field 'description'、日本語メッセージ）
  it("161文字以上の説明は ValidationError を返す", () => {
    fc.assert(
      fc.property(bmpStringInLengthRange(161, 500), (desc) => {
        expect(desc.length).toBeGreaterThan(160);
        const result = validateDescription(desc);
        expect(result).not.toBeNull();
        expect(result?.field).toBe("description");
        expect(result!.message.length).toBeGreaterThan(0);
        expect(/[ぁ-んァ-ヶ一-龠々]/.test(result!.message)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
