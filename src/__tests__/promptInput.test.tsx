import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PromptInput from "../components/PromptInput";

afterEach(cleanup);

describe("PromptInput の履歴選択", () => {
  it("選択した条件を入力欄へ反映し、生成ボタンから再利用できる", () => {
    const onSubmit = vi.fn();
    const previousPrompt = "白い猫が手を振るスタンプ";
    render(
      <PromptInput
        onSubmit={onSubmit}
        history={[
          {
            id: "history-1",
            text: previousPrompt,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "スタンプ内容を作成" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("履歴から選択"), {
      target: { value: previousPrompt },
    });

    expect(
      screen.getByLabelText("共通設定（キャラクターの外見・画風）"),
    ).toHaveValue(previousPrompt);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: previousPrompt,
      count: 8,
      mode: "batch",
      theme: "daily",
      items: expect.arrayContaining([expect.objectContaining({ meaning: "おはよう" })]),
    }));
  });
});
