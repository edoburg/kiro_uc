/**
 * Property 10: ファイル種別バリデーション
 *
 * validateFileType のプロパティベーステスト（fast-check）。
 * Validates: Requirements 4.5
 *
 * validateFileType は filename を小文字化して ".png" で終わるかを判定する。
 * - ".png"（大文字小文字を区別しない）で終わるファイル名 → null
 * - それ以外 → ValidationError { field: "file", message: "PNG形式のファイルを選択してください" }
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateFileType } from "../utils/validation";

// ".png" で終わらないベース名を生成する arbitrary。
// 生成したベース名の末尾が偶然 ".png" にならないよう制約する。
const baseNameArb = fc
  .string()
  .filter((s) => !s.toLowerCase().endsWith(".png"));

// ".png" の各文字をランダムに大文字/小文字化した拡張子を生成する arbitrary。
// 例: ".png" / ".PNG" / ".PnG" / ".pNg" など。
const pngExtArb = fc
  .tuple(fc.boolean(), fc.boolean(), fc.boolean())
  .map(([p, n, g]) => {
    const c = (upper: boolean, ch: string) => (upper ? ch.toUpperCase() : ch);
    return "." + c(p, "p") + c(n, "n") + c(g, "g");
  });

describe("validateFileType - Property 10: ファイル種別バリデーション", () => {
  // Feature: line-stamp-generator, Property 10: .png（大文字小文字問わず）で終わるファイル名は有効（null）
  it("拡張子 .png（大文字小文字の任意組み合わせ）で終わるファイル名は null を返す", () => {
    fc.assert(
      fc.property(baseNameArb, pngExtArb, (base, ext) => {
        const filename = base + ext;
        expect(validateFileType(filename)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Feature: line-stamp-generator, Property 10: .png で終わらないファイル名は ValidationError を返す
  it(".png 以外で終わるファイル名は ValidationError を返す", () => {
    // .png 以外の拡張子・末尾パターンを生成する。
    // - 別拡張子（.jpg/.gif/.txt など）
    // - 拡張子なし
    // - ".png" の後にさらに文字が続く（末尾が .png にならない）
    const nonPngFilenameArb = fc.oneof(
      // 任意ベース名 + 別拡張子
      fc.tuple(
        fc.string(),
        fc.constantFrom(".jpg", ".jpeg", ".gif", ".txt", ".bmp", ".webp", "")
      ).map(([base, ext]) => base + ext),
      // ".png" の後に少なくとも 1 文字続く（末尾が .png にならない）
      fc.tuple(
        fc.string(),
        fc.string({ minLength: 1 }).filter((s) => !s.toLowerCase().endsWith(".png"))
      ).map(([base, tail]) => base + ".png" + tail)
    ).filter((name) => !name.toLowerCase().endsWith(".png"));

    fc.assert(
      fc.property(nonPngFilenameArb, (filename) => {
        const result = validateFileType(filename);
        expect(result).not.toBeNull();
        expect(result?.field).toBe("file");
        expect(result?.message).toBe("PNG形式のファイルを選択してください");
      }),
      { numRuns: 100 }
    );
  });
});
