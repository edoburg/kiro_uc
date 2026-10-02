import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ImagePreviewGrid from "../components/ImagePreviewGrid";
import { createStampPlan, validateStampPlan } from "../utils/stampPlan";
import type { StampPlanItem } from "../types/index";

afterEach(cleanup);

const items = createStampPlan("daily", 8);
const image = { index: 3, itemId: items[3].id, dataUrl: "data:image/png;base64,AA", tempFilePath: "image.png", status: "done" as const };

function renderGrid(onRegenerateWithEdits = vi.fn()) {
  const onRegenerate = vi.fn();
  render(<ImagePreviewGrid images={[image]} items={items} mode="batch" totalCount={8}
    onDelete={vi.fn()} onRegenerate={onRegenerate} onRegenerateWithEdits={onRegenerateWithEdits} />);
  return { onRegenerate, onRegenerateWithEdits };
}

describe("レビュー時の再生成条件", () => {
  it("再生成ボタンではフォームを開くだけで、キャンセルは条件を変更しない", async () => {
    const callbacks = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を再生成" }));
    const form = screen.getByRole("form", { name: "おやすみの再生成条件" });
    expect(within(form).getByLabelText("ポーズ")).toHaveValue("丸くなって枕に頭をのせる");
    expect(screen.getByAltText("生成されたスタンプ画像 4")).toBeInTheDocument();
    expect(callbacks.onRegenerate).not.toHaveBeenCalled();
    expect(callbacks.onRegenerateWithEdits).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("ポーズ"), { target: { value: "仰向けで眠る" } });
    fireEvent.click(within(form).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "画像 4 を再生成" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を再生成" }));
    expect(screen.getByLabelText("ポーズ")).toHaveValue("丸くなって枕に頭をのせる");
    expect(callbacks.onRegenerateWithEdits).not.toHaveBeenCalled();
  });

  it("編集後の1件だけを確定する", () => {
    const callbacks = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を再生成" }));
    const form = screen.getByRole("form", { name: "おやすみの再生成条件" });
    fireEvent.change(within(form).getByLabelText("表情"), { target: { value: "安心した笑顔" } });
    fireEvent.change(within(form).getByLabelText("ポーズ"), { target: { value: "仰向けで両前足をお腹に置いて眠る" } });
    fireEvent.change(within(form).getByLabelText("小物（任意）"), { target: { value: "青い毛布" } });
    fireEvent.change(within(form).getByLabelText("追加の指示（任意・500文字以内）"), { target: { value: "顔を隠さない" } });
    fireEvent.click(within(form).getByRole("button", { name: "この内容で再生成" }));
    expect(callbacks.onRegenerateWithEdits).toHaveBeenCalledWith(3, expect.objectContaining({
      id: items[3].id, position: 3, meaning: "おやすみ", expression: "安心した笑顔",
      pose: "仰向けで両前足をお腹に置いて眠る", prop: "青い毛布", additionalInstructions: "顔を隠さない",
    }));
    expect(items[3].pose).toBe("丸くなって枕に頭をのせる");
  });

  it("空白や意味の重複は確定させず、入力エラーを表示する", () => {
    const callbacks = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を再生成" }));
    fireEvent.change(screen.getByLabelText("伝えたい言葉／意味"), { target: { value: " おはよう " } });
    fireEvent.change(screen.getByLabelText("表情"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    expect(screen.getByRole("alert")).toHaveTextContent("重複");
    expect(callbacks.onRegenerateWithEdits).not.toHaveBeenCalled();
  });

  it("追加指示の500文字超を検証し、未指定データも受け付ける", () => {
    expect(validateStampPlan({ prompt: "共通", count: 8, mode: "batch", items })).toEqual([]);
    const changed: StampPlanItem[] = items.map((item, index) => index === 3
      ? { ...item, additionalInstructions: "あ".repeat(501) } : item);
    expect(validateStampPlan({ prompt: "共通", count: 8, mode: "batch", items: changed })).toContain("4件目の追加の指示は500文字以内にしてください。");
    const longPose = items.map((item, index) => index === 3 ? { ...item, pose: "あ".repeat(101) } : item);
    expect(validateStampPlan({ prompt: "共通", count: 8, mode: "batch", items: longPose })).toContain("4件目のポーズは1～100文字で入力してください。");
  });
});
