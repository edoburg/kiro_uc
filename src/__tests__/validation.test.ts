/**
 * バリデーション関数のスモークテスト
 * タスク 1: テスト環境動作確認用
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validatePrompt,
  validatePromptLength,
  validateTitle,
  validateDescription,
  validateFileType,
} from "../utils/validation";

// ---------------------------------------------------------------------------
// validatePrompt
// ---------------------------------------------------------------------------

describe("validatePrompt", () => {
  it("空文字列はエラーを返す", () => {
    const result = validatePrompt("");
    expect(result).not.toBeNull();
    expect(result?.message).toBe("条件を入力してください");
  });

  it("空白のみはエラーを返す", () => {
    const result = validatePrompt("   ");
    expect(result).not.toBeNull();
    expect(result?.message).toBe("条件を入力してください");
  });

  it("1000文字以内の有効なテキストは null を返す", () => {
    expect(validatePrompt("テスト")).toBeNull();
    expect(validatePrompt("a".repeat(1000))).toBeNull();
  });

  it("1001文字以上はエラーを返す", () => {
    expect(validatePrompt("a".repeat(1001))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validatePromptLength
// ---------------------------------------------------------------------------

describe("validatePromptLength", () => {
  it("1000文字以内は null を返す", () => {
    expect(validatePromptLength("a".repeat(1000))).toBeNull();
  });

  it("1001文字以上はエラーを返す", () => {
    expect(validatePromptLength("a".repeat(1001))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateTitle
// ---------------------------------------------------------------------------

describe("validateTitle", () => {
  it("空文字列はエラーを返す", () => {
    expect(validateTitle("")).not.toBeNull();
  });

  it("1〜40文字は null を返す", () => {
    expect(validateTitle("a")).toBeNull();
    expect(validateTitle("a".repeat(40))).toBeNull();
  });

  it("41文字以上はエラーを返す", () => {
    expect(validateTitle("a".repeat(41))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateDescription
// ---------------------------------------------------------------------------

describe("validateDescription", () => {
  it("空文字列は null を返す（説明は任意）", () => {
    expect(validateDescription("")).toBeNull();
  });

  it("0〜160文字は null を返す", () => {
    expect(validateDescription("a".repeat(160))).toBeNull();
  });

  it("161文字以上はエラーを返す", () => {
    expect(validateDescription("a".repeat(161))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateFileType
// ---------------------------------------------------------------------------

describe("validateFileType", () => {
  it(".png は null を返す", () => {
    expect(validateFileType("stamp.png")).toBeNull();
  });

  it(".PNG（大文字）は null を返す", () => {
    expect(validateFileType("stamp.PNG")).toBeNull();
  });

  it(".jpg はエラーを返す", () => {
    const result = validateFileType("stamp.jpg");
    expect(result).not.toBeNull();
    expect(result?.message).toBe("PNG形式のファイルを選択してください");
  });

  it(".gif はエラーを返す", () => {
    expect(validateFileType("stamp.gif")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fast-check スモークテスト（テスト環境の動作確認）
// ---------------------------------------------------------------------------

describe("fast-check 動作確認", () => {
  it("任意の文字列で validatePrompt が例外をスローしない", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        // 例外がスローされないこと
        expect(() => validatePrompt(s)).not.toThrow();
        // 戻り値は null または ValidationError オブジェクト
        const result = validatePrompt(s);
        if (result !== null) {
          expect(result).toHaveProperty("field");
          expect(result).toHaveProperty("message");
        }
      }),
      { numRuns: 100 }
    );
  });
});
