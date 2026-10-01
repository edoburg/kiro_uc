import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StampPlanEditor from "../components/StampPlanEditor";
import ImagePreviewGrid from "../components/ImagePreviewGrid";
import { createStampPlan, validateStampPlan } from "../utils/stampPlan";
import type { GenerationRequest, StampCount, StampTheme } from "../types/index";

afterEach(cleanup);

describe("定型企画", () => {
  it.each(["daily", "work"] as StampTheme[])("%s で全枚数の異なる項目を作る", (theme) => {
    for (const count of [8, 16, 24, 32, 40] as StampCount[]) {
      const items = createStampPlan(theme, count);
      expect(items).toHaveLength(count);
      expect(new Set(items.map((item) => item.meaning)).size).toBe(count);
      expect(items.map((item) => item.position)).toEqual(Array.from({ length: count }, (_, index) => index));
    }
  });

  it("編集した内容を確定し、重複・空白を拒否する", () => {
    const request: GenerationRequest = { prompt: "白いアザラシ", count: 8, mode: "batch", theme: "daily", items: createStampPlan("daily", 8) };
    const onGenerate = vi.fn();
    render(<StampPlanEditor request={request} onBack={vi.fn()} onGenerate={onGenerate} />);
    expect(onGenerate).not.toHaveBeenCalled();
    const fourth = screen.getByRole("group", { name: "4枚目" });
    fireEvent.change(fourth.querySelectorAll("input")[1], { target: { value: "とても眠い" } });
    fireEvent.change(fourth.querySelectorAll("input")[2], { target: { value: "枕に顔をうずめる" } });
    fireEvent.change(fourth.querySelectorAll("input")[3], { target: { value: "青い枕" } });
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));
    expect(onGenerate.mock.calls[0][0].items[3]).toMatchObject({ expression: "とても眠い", pose: "枕に顔をうずめる", prop: "青い枕" });
    expect(request.items?.[3].expression).toBe("安心して眠る");
    const bad = { ...request, items: request.items?.map((item, index) => index === 3 ? { ...item, meaning: " おはよう " } : item) };
    expect(validateStampPlan(bad)).toContain("「おはよう」が重複しています。");
  });

  it("削除した位置を企画ラベル付きで残し、同じ絶対位置で再生成する", () => {
    const items = createStampPlan("daily", 8);
    const onRegenerate = vi.fn();
    render(<ImagePreviewGrid images={[]} items={items} mode="batch" totalCount={8} onDelete={vi.fn()} onRegenerate={onRegenerate} />);
    expect(screen.getByText("おやすみ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を生成" }));
    expect(onRegenerate).toHaveBeenCalledWith(3);
  });

  it("表示順が変わっても項目IDのラベルを維持する", () => {
    const items = createStampPlan("daily", 8);
    const reversed = [...items].reverse();
    render(<ImagePreviewGrid
      images={[{ index: 3, itemId: items[3].id, dataUrl: "data:image/png;base64,AA", tempFilePath: "x", status: "done" }]}
      items={reversed} mode="batch" totalCount={8} onDelete={vi.fn()} onRegenerate={vi.fn()}
    />);
    expect(screen.getByText("おやすみ")).toBeInTheDocument();
    expect(screen.getByAltText("生成されたスタンプ画像 4")).toBeInTheDocument();
  });
});
