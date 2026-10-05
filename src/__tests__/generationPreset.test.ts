import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createPresetSnapshot, parsePresetSnapshot } from "../utils/generationPreset";
import { createStampPlan, validateStampPlan } from "../utils/stampPlan";
import { toGenerationStartRequest } from "../utils/generationFlow";

const request = { prompt: "共通", theme: "daily" as const, count: 8 as const, mode: "batch" as const, items: createStampPlan("daily", 8) };
const options = { model: "gpt-image-2.5-flare" as const, quality: "auto" as const };

describe("生成設定の保存検証", () => {
  it("保存可能な下書きと生成可能な条件を分ける", () => {
    const draft = createPresetSnapshot({ ...request, prompt: "", items: request.items.map((item) => ({ ...item, meaning: "", pose: "", expression: "", displayText: "" })) }, options);
    expect(parsePresetSnapshot(draft)).toEqual(draft);
    expect(validateStampPlan(draft.request).length).toBeGreaterThan(0);
  });
  it("旧項目はfalse/nullに正規化し、新規の文字ありへ書き換えない", () => {
    const old = request.items.map(({ textEnabled: _text, displayText: _display, ...item }) => item);
    expect(createPresetSnapshot({ ...request, items: old }, options).request.items?.every((item) => item.textEnabled === false && item.displayText === null)).toBe(true);
  });
  it.each([
    { count: 7 }, { mode: "unknown" }, { theme: "unknown" }, { prompt: "あ".repeat(1001) },
    { items: request.items.slice(1) },
    { items: request.items.map((item) => ({ ...item, id: "duplicate" })) },
    { items: request.items.map((item) => ({ ...item, position: 99 })) },
    { items: request.items.map((item) => ({ ...item, textEnabled: "false" })) },
    { items: request.items.map((item) => ({ ...item, displayText: false })) },
    { items: request.items.map((item) => ({ ...item, additionalInstructions: "あ".repeat(501) })) },
  ])("不正な型・範囲を拒否する: %j", (change) => {
    expect(() => parsePresetSnapshot({ request: { ...request, ...change }, options })).toThrow();
  });
  it("将来のsourceTemplateIdは保存し、API要求には含めない", () => {
    const saved = createPresetSnapshot({ ...request, items: request.items.map((item) => ({ ...item, sourceTemplateId: "optional-template" })) }, options);
    expect(saved.request.items?.[0].sourceTemplateId).toBe("optional-template");
    expect(toGenerationStartRequest(saved.request, null, { count: 8, startIndex: 0 }).items?.[0]).not.toHaveProperty("sourceTemplateId");
  });
  // Feature: line-stamp-generator, Property: 保存可能な描き文字のJSON往復はfalse/null/空文字を保持する
  it("文字設定はJSON往復で欠落しない（100例）", () => {
    fc.assert(fc.property(fc.boolean(), fc.option(fc.string({ maxLength: 100 }), { nil: null }), (enabled, text) => {
      const snapshot = createPresetSnapshot({ ...request, items: request.items.map((item) => ({ ...item, textEnabled: enabled, displayText: text })) }, options);
      const restored = parsePresetSnapshot(JSON.parse(JSON.stringify(snapshot)));
      expect(restored.request.items?.[0]).toMatchObject({ textEnabled: enabled, displayText: text });
    }), { numRuns: 100 });
  });
});
