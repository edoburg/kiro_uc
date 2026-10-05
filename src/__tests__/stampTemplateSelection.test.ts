import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  clearPlanSelection,
  createStampPlan,
  deselectPlanItem,
  fillPlanSelection,
  findStampTemplate,
  getPlanSelectionStatus,
  getStampTemplateCatalog,
  hasPlanSelectionWork,
  reconcilePlanItems,
  resetPlanSelection,
  selectDraftItem,
  selectTemplate,
  templateOf,
  validateStampPlan,
  type PlanSelection,
} from "../utils/stampPlan";
import { toGenerationStartRequest } from "../utils/generationFlow";
import { createPresetSnapshot, parsePresetSnapshot } from "../utils/generationPreset";
import type { GenerationRequest, StampCount, StampPlanItem, StampTheme } from "../types/index";

const THEMES: StampTheme[] = ["daily", "work"];
const COUNTS: StampCount[] = [8, 16, 24, 32, 40];
const empty: PlanSelection = { items: [], drafts: [] };

function selectMany(theme: StampTheme, count: number, numbers: number[], start: PlanSelection = empty): PlanSelection {
  return numbers.reduce((selection, number) => {
    const result = selectTemplate(theme, count, selection, getStampTemplateCatalog(theme)[number - 1].id);
    expect(result.error).toBeNull();
    return result.selection;
  }, start);
}
const numbersOf = (items: StampPlanItem[], theme: StampTheme) => items.map((item) => templateOf(item, theme)?.catalogNumber);
const NON_HEAD = [2, 12, 40, 5, 33, 21, 9, 17];

describe("テンプレートカタログ", () => {
  it("各テーマ40件で、テンプレートIDはテーマ内・テーマ間で一意かつ安定", () => {
    const all = THEMES.flatMap((theme) => getStampTemplateCatalog(theme));
    expect(all).toHaveLength(80);
    expect(new Set(all.map((template) => template.id)).size).toBe(80);
    for (const theme of THEMES) {
      const catalog = getStampTemplateCatalog(theme);
      expect(catalog.map((template) => template.catalogNumber)).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
      expect(catalog[0].id).toBe(`${theme}-t01`);
      expect(catalog[39].id).toBe(`${theme}-t40`);
      expect(getStampTemplateCatalog(theme)).toBe(catalog);
    }
    expect(findStampTemplate("daily-t40", "work")).toBeUndefined();
    expect(findStampTemplate("daily-t41")).toBeUndefined();
  });

  it.each(THEMES)("%s の初期選択は従来どおり先頭N件で、由来IDと新規文字設定を持つ", (theme) => {
    for (const count of COUNTS) {
      const items = createStampPlan(theme, count);
      expect(items.map((item) => item.meaning)).toEqual(getStampTemplateCatalog(theme).slice(0, count).map((template) => template.meaning));
      expect(items.map((item) => item.position)).toEqual(Array.from({ length: count }, (_, index) => index));
      items.forEach((item, index) => expect(item).toMatchObject({ sourceTemplateId: `${theme}-t${String(index + 1).padStart(2, "0")}`, textEnabled: true, displayText: null }));
      expect(validateStampPlan({ prompt: "共通", count, mode: "batch", theme, items })).toEqual([]);
    }
  });
});

describe("選択から生成企画への変換", () => {
  it("8枚で先頭以外と40番目を選ぶと、カタログ順の8件が位置0～7になる", () => {
    const { items } = selectMany("daily", 8, NON_HEAD);
    expect(numbersOf(items, "daily")).toEqual([2, 5, 9, 12, 17, 21, 33, 40]);
    expect(items.map((item) => item.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(items[7]).toMatchObject({ id: "plan-daily-t40", sourceTemplateId: "daily-t40", meaning: "おやつの時間", textEnabled: true, displayText: null });
    const request: GenerationRequest = { prompt: "白いアザラシ", count: 8, mode: "batch", theme: "daily", items };
    expect(validateStampPlan(request)).toEqual([]);
    const sent = toGenerationStartRequest(request, null, { count: 8, startIndex: 0 });
    expect(sent.items).toHaveLength(8);
    expect(sent.items?.map((item) => item.meaning)).toEqual(items.map((item) => item.meaning));
    sent.items?.forEach((item) => expect(item).not.toHaveProperty("sourceTemplateId"));
  });

  it("上限到達後の選択は案内を返し、ほかの項目を外さない", () => {
    const full = selectMany("daily", 8, NON_HEAD);
    const result = selectTemplate("daily", 8, full, "daily-t01");
    expect(result.error).toBe("選択できるのは8件までです。入れ替える場合は、先にほかの項目のチェックを外してください。");
    expect(result.selection).toBe(full);
    const swapped = selectTemplate("daily", 8, deselectPlanItem(full, "plan-daily-t12"), "daily-t01");
    expect(swapped.error).toBeNull();
    expect(numbersOf(swapped.selection.items, "daily")).toEqual([1, 2, 5, 9, 17, 21, 33, 40]);
  });

  it("不正・別テーマのカタログIDは選択できない", () => {
    expect(selectTemplate("daily", 8, empty, "work-t01").error).toBe("選択できないテンプレートです。");
    expect(selectTemplate("daily", 8, empty, "daily-t99").error).toBe("選択できないテンプレートです。");
  });

  it("選択変更で継続項目の編集を保持し、外した項目は下書きから復元、新規だけテンプレートで初期化する", () => {
    const start = { items: createStampPlan("daily", 8), drafts: [] };
    const edited: PlanSelection = { ...start, items: start.items.map((item) => item.position === 1
      ? { ...item, meaning: "やあ", pose: "跳ねる", prop: "旗", additionalInstructions: "左向き", textEnabled: false, displayText: "やあ!" }
      : item.position === 3 ? { ...item, displayText: "" } : item) };
    const removed = deselectPlanItem(edited, "plan-daily-t04");
    expect(removed.items).toHaveLength(7);
    expect(removed.items[1]).toMatchObject({ meaning: "やあ", pose: "跳ねる", additionalInstructions: "左向き", textEnabled: false, displayText: "やあ!" });
    expect(removed.drafts.map((item) => item.id)).toEqual(["plan-daily-t04"]);
    const added = selectTemplate("daily", 8, removed, "daily-t40").selection;
    expect(added.items[7]).toMatchObject({ id: "plan-daily-t40", position: 7, textEnabled: true, displayText: null });
    expect(added.items[7].additionalInstructions).toBeUndefined();
    const restored = selectTemplate("daily", 8, deselectPlanItem(added, "plan-daily-t40"), "daily-t04").selection;
    expect(restored.items[3]).toMatchObject({ id: "plan-daily-t04", position: 3, displayText: "" });
    expect(restored.items[1].meaning).toBe("やあ");
    expect(restored.drafts.map((item) => item.id)).toEqual(["plan-daily-t40"]);
  });

  it("先頭N件に戻す・選択解除・40枚の全件選択は編集を消さない", () => {
    const picked = selectMany("work", 8, NON_HEAD);
    const edited: PlanSelection = { ...picked, items: picked.items.map((item) => item.sourceTemplateId === "work-t02" ? { ...item, pose: "編集済み" } : item) };
    const reset = resetPlanSelection("work", 8, edited);
    expect(numbersOf(reset.items, "work")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(reset.items[1].pose).toBe("編集済み");
    // No.2・No.5は継続選択、ほかの6件は下書きへ
    expect(reset.drafts.map((item) => item.sourceTemplateId)).toEqual(["work-t09", "work-t12", "work-t17", "work-t21", "work-t33", "work-t40"]);
    const cleared = clearPlanSelection(reset);
    expect(cleared.items).toEqual([]);
    expect(cleared.drafts).toHaveLength(14);
    const all = fillPlanSelection("work", 40, cleared);
    expect(numbersOf(all.items, "work")).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(all.items[1].pose).toBe("編集済み");
    expect(all.drafts).toEqual([]);
    expect(validateStampPlan({ prompt: "共通", count: 40, mode: "batch", theme: "work", items: all.items })).toEqual([]);
  });

  it("件数の過不足を表示用に返す", () => {
    expect(getPlanSelectionStatus(16, createStampPlan("daily", 8))).toMatchObject({ selected: 8, shortage: 8, excess: 0, complete: false });
    expect(getPlanSelectionStatus(8, createStampPlan("daily", 16))).toMatchObject({ selected: 16, shortage: 0, excess: 8, complete: false });
    expect(getPlanSelectionStatus(8, createStampPlan("daily", 8)).complete).toBe(true);
  });

  it("テーマ変更の確認が必要な作業を判定する", () => {
    expect(hasPlanSelectionWork("daily", 8, { items: createStampPlan("daily", 8), drafts: [] })).toBe(false);
    expect(hasPlanSelectionWork("daily", 8, selectMany("daily", 8, NON_HEAD))).toBe(true);
    const items = createStampPlan("daily", 8);
    items[0] = { ...items[0], additionalInstructions: "編集" };
    expect(hasPlanSelectionWork("daily", 8, { items, drafts: [] })).toBe(true);
  });

  it("下書きのカスタム企画は再選択でき、上限を守る", () => {
    const custom: StampPlanItem = { id: "daily-1", position: 0, meaning: "旧項目", expression: "笑顔", pose: "手を振る", prop: "" };
    const selection = { items: createStampPlan("daily", 8).slice(0, 7), drafts: [custom] };
    const result = selectDraftItem(8, selection, "daily-1");
    expect(result.selection.items[7]).toMatchObject({ id: "daily-1", position: 7, meaning: "旧項目" });
    expect(selectDraftItem(8, result.selection, "daily-1").error).toBe("選択できない項目です。");
  });
});

describe("生成企画の検証", () => {
  const base = (): GenerationRequest => ({ prompt: "共通", count: 8, mode: "batch", theme: "daily", items: selectMany("daily", 8, NON_HEAD).items });
  it("不正なカタログID・別テーマID・重複選択を拒否する", () => {
    const request = base();
    expect(validateStampPlan({ ...request, items: request.items!.map((item, index) => index === 2 ? { ...item, sourceTemplateId: "daily-t99" } : item) })).toContain("3件目のテンプレートIDが不正です。");
    expect(validateStampPlan({ ...request, items: request.items!.map((item, index) => index === 2 ? { ...item, sourceTemplateId: "work-t03" } : item) })).toContain("3件目のテンプレートIDが不正です。");
    expect(validateStampPlan({ ...request, items: request.items!.map((item, index) => index === 2 ? { ...item, sourceTemplateId: request.items![0].sourceTemplateId, meaning: "別の言葉" } : item) })).toContain("3件目のテンプレートが重複して選択されています。");
  });
  it("件数不一致とカタログ番号を使った生成位置を拒否する", () => {
    const request = base();
    expect(validateStampPlan({ ...request, items: request.items!.slice(0, 7) })).toContain("企画の件数がスタンプ枚数と一致しません。");
    expect(validateStampPlan({ ...request, items: [...request.items!, createStampPlan("daily", 8)[0]] })).toContain("企画の件数がスタンプ枚数と一致しません。");
    // 40番目のテンプレートでも生成位置は39ではなくセット内の7でなければならない
    expect(validateStampPlan({ ...request, items: request.items!.map((item, index) => index === 7 ? { ...item, position: 39 } : item) })).toContain("8件目のIDまたは位置が不正です。");
  });
});

describe("旧データ・保存データの照合", () => {
  it("sourceTemplateIdのない旧itemsはカスタム企画として保持し、意味が同じでも紐付けない", () => {
    const legacy: StampPlanItem[] = createStampPlan("daily", 8).map(({ sourceTemplateId: _source, ...item }, index) => ({ ...item, id: `daily-${index + 1}` }));
    const reconciled = reconcilePlanItems("daily", legacy);
    expect(reconciled).toEqual(legacy);
    reconciled.forEach((item) => expect(templateOf(item, "daily")).toBeUndefined());
    expect(validateStampPlan({ prompt: "共通", count: 8, mode: "batch", theme: "daily", items: reconciled })).toEqual([]);
  });
  it("未知・別テーマ・重複のテンプレートIDは外してカスタム企画にする", () => {
    const items = createStampPlan("daily", 8);
    items[1] = { ...items[1], sourceTemplateId: "daily-t77" };
    items[2] = { ...items[2], sourceTemplateId: "work-t03" };
    items[3] = { ...items[3], sourceTemplateId: "daily-t01" };
    const reconciled = reconcilePlanItems("daily", items);
    expect(reconciled.map((item) => item.sourceTemplateId)).toEqual(["daily-t01", undefined, undefined, undefined, "daily-t05", "daily-t06", "daily-t07", "daily-t08"]);
    expect(reconciled[1]).not.toHaveProperty("sourceTemplateId");
  });
  it("選択テンプレートID・生成順・個別編集を保存スナップショットで往復する", () => {
    const items = selectMany("daily", 8, NON_HEAD).items.map((item) => item.sourceTemplateId === "daily-t40" ? { ...item, pose: "クッキーを掲げる", textEnabled: false, displayText: "" } : item);
    const request: GenerationRequest = { prompt: "共通", count: 8, mode: "preview_approval", theme: "daily", items };
    const restored = parsePresetSnapshot(JSON.parse(JSON.stringify(createPresetSnapshot(request, { model: "gpt-image-2.5-flare", quality: "auto" }))));
    expect(restored.request.items?.map((item) => item.sourceTemplateId)).toEqual(items.map((item) => item.sourceTemplateId));
    expect(restored.request.items?.[7]).toMatchObject({ id: "plan-daily-t40", position: 7, pose: "クッキーを掲げる", textEnabled: false, displayText: "" });
  });
  it("選択数と枚数が一致しない作業は保存せず理由を示す", () => {
    expect(() => createPresetSnapshot({ prompt: "共通", count: 16, mode: "batch", theme: "daily", items: createStampPlan("daily", 8) }, { model: "gpt-image-2.5-flare", quality: "auto" }))
      .toThrow("選択中の項目（8件）がスタンプ枚数（16枚）と一致しないため保存できません。");
  });
});

// Feature: line-stamp-generator, Property 21: テンプレート選択は上限・位置・一意性・カタログ順・編集保持を常に満たす
describe("Property 21: テンプレート選択の不変条件", () => {
  it("任意の選択・解除・リセット操作列で生成企画が整合する", () => {
    const operation = fc.oneof(
      fc.record({ kind: fc.constant("toggle" as const), number: fc.integer({ min: 1, max: 40 }) }),
      fc.record({ kind: fc.constant("edit" as const), number: fc.integer({ min: 1, max: 40 }) }),
      fc.constant({ kind: "reset" as const, number: 0 }),
      fc.constant({ kind: "clear" as const, number: 0 }),
    );
    fc.assert(fc.property(fc.constantFrom(...THEMES), fc.constantFrom(...COUNTS), fc.array(operation, { maxLength: 60 }), (theme, count, operations) => {
      let selection: PlanSelection = { items: createStampPlan(theme, count), drafts: [] };
      const edits = new Map<string, string>();
      for (const op of operations) {
        const template = getStampTemplateCatalog(theme)[Math.max(op.number, 1) - 1];
        const selected = selection.items.find((item) => item.sourceTemplateId === template.id);
        if (op.kind === "toggle") {
          if (selected) selection = deselectPlanItem(selection, selected.id);
          else {
            const before = selection;
            const result = selectTemplate(theme, count, selection, template.id);
            if (before.items.length >= count) { expect(result.error).not.toBeNull(); expect(result.selection).toBe(before); }
            selection = result.selection;
          }
        } else if (op.kind === "edit" && selected) {
          const pose = `編集${edits.size}`;
          edits.set(template.id, pose);
          selection = { ...selection, items: selection.items.map((item) => item.id === selected.id ? { ...item, pose } : item) };
        } else if (op.kind === "reset") selection = resetPlanSelection(theme, count, selection);
        else if (op.kind === "clear") selection = clearPlanSelection(selection);

        const { items, drafts } = selection;
        expect(items.length).toBeLessThanOrEqual(count);
        expect(items.map((item) => item.position)).toEqual(items.map((_, index) => index));
        const ids = [...items, ...drafts].map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        const numbers = numbersOf(items, theme) as number[];
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
        for (const item of [...items, ...drafts]) {
          expect(item.id).toBe(`plan-${item.sourceTemplateId}`);
          const pose = edits.get(item.sourceTemplateId!);
          if (pose) expect(item.pose).toBe(pose);
        }
        if (items.length === count) expect(validateStampPlan({ prompt: "共通", count, mode: "batch", theme, items }).filter((error) => !error.includes("重複"))).toEqual([]);
      }
    }), { numRuns: 100 });
  });
});
