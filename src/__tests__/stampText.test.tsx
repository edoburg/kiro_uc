import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import StampPlanEditor from "../components/StampPlanEditor";
import { createStampPlan, normalizeStampPlanItem, resolveDisplayText, validateStampPlan } from "../utils/stampPlan";
import { toGenerationStartRequest } from "../utils/generationFlow";
import type { GenerationRequest } from "../types/index";

afterEach(cleanup);
const makeRequest = (): GenerationRequest => ({ prompt: "白いアザラシ", count: 8, mode: "batch", theme: "daily", items: createStampPlan("daily", 8) });

describe("画像ごとの文字設定", () => {
  it("新規だけ文字ありで、旧項目は文字なしに正規化する", () => {
    const item = createStampPlan("daily", 8)[0];
    expect(item).toMatchObject({ textEnabled: true, displayText: null });
    const { textEnabled: _enabled, displayText: _text, ...legacy } = item;
    expect(normalizeStampPlanItem(legacy)).toMatchObject({ textEnabled: false, displayText: null });
  });

  it("意味への追従、任意文字、オフ時の保持、意味に戻す操作を生成せず行える", () => {
    const request = makeRequest();
    const generate = vi.fn();
    render(<StampPlanEditor request={request} onBack={vi.fn()} onGenerate={generate} />);
    const first = within(screen.getByRole("group", { name: "1枚目" }));
    const text = first.getByLabelText("画像に描く文字");
    expect(text).toHaveValue("おはよう");
    fireEvent.change(first.getByLabelText("伝えたい言葉／意味"), { target: { value: "朝の挨拶" } });
    expect(text).toHaveValue("朝の挨拶");
    fireEvent.change(text, { target: { value: "おはよう！★" } });
    fireEvent.change(first.getByLabelText("伝えたい言葉／意味"), { target: { value: "元気な朝" } });
    expect(text).toHaveValue("おはよう！★");
    fireEvent.click(first.getByLabelText("文字を入れる"));
    expect(text).toBeDisabled();
    expect(text).toHaveValue("おはよう！★");
    fireEvent.click(first.getByLabelText("文字を入れる"));
    expect(text).toHaveValue("おはよう！★");
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(first.getByRole("button", { name: "意味を使用に戻す" }));
    expect(text).toHaveValue("元気な朝");
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));
    expect(generate.mock.calls[0][0].items[0]).toMatchObject({ textEnabled: true, displayText: null });
    expect(request.items?.[0].meaning).toBe("おはよう");
  });

  it("空欄を意味へ置換せず、文字なしの長さも検証し、表示文字の重複は許可する", () => {
    const request = makeRequest();
    const item = request.items![0];
    item.displayText = " ";
    expect(resolveDisplayText(item)).toBe("");
    expect(validateStampPlan(request)).not.toEqual([]);
    item.textEnabled = false;
    expect(validateStampPlan(request)).toEqual([]);
    item.displayText = "あ".repeat(101);
    expect(validateStampPlan(request)).not.toEqual([]);
    item.displayText = "😀".repeat(100);
    expect(validateStampPlan(request)).toEqual([]);
    request.items!.forEach((current) => { current.displayText = "OK"; });
    expect(validateStampPlan(request)).toEqual([]);
  });

  it("IPC要求はfalse・null・空文字を保持した独立したスナップショットになる", () => {
    const request = makeRequest();
    request.items![0].textEnabled = false;
    request.items![0].displayText = "";
    const sent = toGenerationStartRequest(request, null, { count: 1, startIndex: 3 });
    expect(JSON.parse(JSON.stringify(sent)).items[0]).toMatchObject({ textEnabled: false, displayText: "" });
    expect(sent.items![1].displayText).toBeNull();
    request.items![3].displayText = "後から変更";
    expect(sent.items![3].displayText).toBeNull();
  });
});
