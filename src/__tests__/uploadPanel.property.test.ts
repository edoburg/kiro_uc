/**
 * UploadPanel の canUpload 純粋述語に対するプロパティベーステスト。
 *
 * canUpload(isValidForUpload, credentialsConfigured) は
 * isValidForUpload && credentialsConfigured を返す。
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { canUpload } from "../components/UploadPanel";

// Feature: line-stamp-generator, Property 12: バリデーション状態とアップロードボタンの連動
// Validates: Requirements 5.6
describe("Property 12: バリデーション状態とアップロードボタンの連動", () => {
  it("canUpload(v, c) は常に (v && c) と等しい", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (v, c) => {
        expect(canUpload(v, c)).toBe(v && c);
      }),
      { numRuns: 100 }
    );
  });

  it("isValidForUpload が false のとき canUpload は常に false（ボタン無効）", () => {
    fc.assert(
      fc.property(fc.boolean(), (c) => {
        expect(canUpload(false, c)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("両方 true のときのみ canUpload は true", () => {
    expect(canUpload(true, true)).toBe(true);
  });
});
