import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppInner } from "../App";
import { AppStoreProvider, initialAppState } from "../stores/appStore";
import { createStampPlan } from "../utils/stampPlan";
import type { Config, GenerationRequest, StampPlanItem } from "../types/index";
import type { GenerationStreamPayload } from "../types/window-api";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "api", { configurable: true, value: undefined });
});

const config: Config = {
  aiEngine: "openai", outputDirectory: "C:/out", openaiModel: "gpt-image-2.5-flare",
  openaiQuality: "high", sdEndpoint: "",
};

/** 生成APIへ送る形（由来のテンプレートIDは送らない）。 */
function apiItem({ sourceTemplateId: _sourceTemplateId, ...item }: StampPlanItem) { return item; }

function setup(mode: GenerationRequest["mode"] = "batch") {
  const items = createStampPlan("daily", 8);
  const request: GenerationRequest = { prompt: "白いアザラシ", count: 8, mode, theme: "daily", items };
  const generatedImages = Array.from({ length: mode === "batch" ? 8 : 1 }, (_, index) => ({
    index, itemId: items[index].id, dataUrl: `data:image/png;base64,${index}`, tempFilePath: `image-${index}.png`, status: "done" as const,
    textSettings: { textEnabled: true, displayText: items[index].meaning },
  }));
  let listener: ((payload: GenerationStreamPayload) => void) | undefined;
  const generate = vi.fn().mockResolvedValueOnce({ streamId: "run-1" }).mockResolvedValueOnce({ streamId: "run-2" });
  const api = {
    image: { generate },
    onGenerateProgress: (callback: (payload: GenerationStreamPayload) => void) => {
      listener = callback;
      return vi.fn();
    },
    config: { get: vi.fn().mockResolvedValue(config) },
    credential: { get: vi.fn().mockResolvedValue({ configured: true }) },
  };
  Object.defineProperty(window, "api", { configurable: true, value: api });
  render(<AppStoreProvider initialState={{ ...initialAppState, config, needsSetup: false, aiApiKeyConfigured: true,
    currentRequest: request, generatedImages, step: "preview" }}><AppInner /></AppStoreProvider>);
  return { generate, items, getListener: () => listener };
}

describe("Appの個別再生成", () => {
  it("詳細から対象1枚を再生成し、失敗後の再試行成功で詳細と一覧を同時に更新する", async () => {
    const { generate, items, getListener } = setup();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を大きく表示" }));
    fireEvent.change(screen.getByLabelText("ポーズ"), { target: { value: "仰向けで眠る" } });
    fireEvent.change(screen.getByLabelText("画像に描く文字"), { target: { value: "ぐっすり！" } });
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate.mock.calls[0][0]).toMatchObject({ count: 1, startIndex: 3 });
    expect(generate.mock.calls[0][0].items[4]).toEqual(apiItem(items[4]));
    expect(generate.mock.calls[0][0]).not.toHaveProperty("background");
    expect(screen.getByRole("dialog")).toHaveTextContent("生成中（元画像を表示しています）");
    await act(async () => {
      getListener()?.({ streamId: "run-1", event: "done", data: { status: "failed", total: 1, succeeded: 0, failed: 1 } });
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("表示画像に使った文字：おやすみ");
    expect(screen.getByRole("dialog")).toHaveTextContent("次回の再生成条件：おやすみ ／ 仰向けで眠る ／ ぐっすり！");
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await act(async () => {
      getListener()?.({ streamId: "run-2", event: "progress", data: { completed: 1, total: 1, latestImagePath: "new.png", index: 3, dataUrl: "data:image/png;base64,new", error: null } });
      getListener()?.({ streamId: "run-2", event: "done", data: { status: "done", total: 1, succeeded: 1, failed: 0 } });
    });
    expect(screen.getAllByAltText("生成されたスタンプ画像 4", { exact: true })).toHaveLength(2);
    screen.getAllByAltText("生成されたスタンプ画像 4").forEach((image) => expect(image).toHaveAttribute("src", "data:image/png;base64,new"));
    expect(screen.getByRole("dialog")).toHaveTextContent("表示画像の生成条件：おやすみ ／ 安心して眠る ／ 仰向けで眠る");
    expect(screen.getByRole("dialog")).toHaveTextContent("表示画像に使った文字：ぐっすり！");
  });
  it("成功時は対象画像だけを差し替え、削除後も最新条件で再生成する", async () => {
    const { generate, getListener } = setup();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を再生成" }));
    fireEvent.change(screen.getByLabelText("ポーズ"), { target: { value: "仰向けで眠る" } });
    fireEvent.change(screen.getByLabelText("画像に描く文字"), { target: { value: "ぐっすり！" } });
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "画像 5 を再生成" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "画像 5 を再生成" }));
    expect(generate).toHaveBeenCalledTimes(1);
    await act(async () => {
      getListener()?.({ streamId: "run-1", event: "progress", data: { completed: 1, total: 1, latestImagePath: "new.png",
        index: 3, dataUrl: "data:image/png;base64,new", error: null } });
      getListener()?.({ streamId: "run-1", event: "done", data: { status: "done", total: 1, succeeded: 1, failed: 0 } });
    });
    expect(screen.getByAltText("生成されたスタンプ画像 4")).toHaveAttribute("src", "data:image/png;base64,new");
    expect(screen.getByAltText("生成されたスタンプ画像 5")).toHaveAttribute("src", "data:image/png;base64,4");
    expect(screen.getByText("生成に使った文字：表示文字：ぐっすり！")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を再生成" }));
    expect(screen.getByLabelText("ポーズ")).toHaveValue("仰向けで眠る");
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を生成" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls[1][0]).toMatchObject({ count: 1, startIndex: 3 });
    expect(generate.mock.calls[1][0].items[3].pose).toBe("仰向けで眠る");
    expect(generate.mock.calls[1][0].items[3].displayText).toBe("ぐっすり！");
  });

  it("編集済みの全企画を対象位置1件のIPC要求へ渡し、失敗しても元画像と条件を残す", async () => {
    const { generate, items, getListener } = setup();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を再生成" }));
    expect(generate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("ポーズ"), { target: { value: "仰向けで眠る" } });
    fireEvent.change(screen.getByLabelText("小物（任意）"), { target: { value: "青い毛布" } });
    fireEvent.change(screen.getByLabelText("追加の指示（任意・500文字以内）"), { target: { value: "顔を隠さない" } });
    fireEvent.change(screen.getByLabelText("画像に描く文字"), { target: { value: "おやすみ★" } });
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const sent = generate.mock.calls[0][0];
    expect(sent).toMatchObject({ prompt: "白いアザラシ", count: 1, startIndex: 3, mode: "batch", model: config.openaiModel, quality: config.openaiQuality });
    expect(sent.items).toHaveLength(8);
    expect(sent.items[3]).toMatchObject({ id: items[3].id, position: 3, pose: "仰向けで眠る", prop: "青い毛布", additionalInstructions: "顔を隠さない" });
    expect(sent.items[0]).toEqual(apiItem(items[0]));
    expect(sent.items[4]).toEqual(apiItem(items[4]));
    expect(sent.items[3]).toMatchObject({ textEnabled: true, displayText: "おやすみ★" });
    await act(async () => {
      getListener()?.({ streamId: "run-1", event: "progress", data: { completed: 1, total: 1, latestImagePath: null,
        index: 3, dataUrl: null, error: { index: 3, errorType: "api_error", message: "失敗" } } });
      getListener()?.({ streamId: "run-1", event: "done", data: { status: "failed", total: 1, succeeded: 0, failed: 1 } });
    });
    expect(screen.getByAltText("生成されたスタンプ画像 4")).toHaveAttribute("src", "data:image/png;base64,3");
    expect(screen.getByRole("alert")).toHaveTextContent("元画像は保持");
    expect(screen.queryByText("生成に使った文字：表示文字：おやすみ★")).not.toBeInTheDocument();
    expect(screen.getByText("生成に使った文字：表示文字：おやすみ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "画像 4 を再生成" }));
    expect(screen.getByLabelText("ポーズ")).toHaveValue("仰向けで眠る");
    expect(screen.getByLabelText("画像に描く文字")).toHaveValue("おやすみ★");
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls[1][0].items[3].pose).toBe("仰向けで眠る");
    expect(generate.mock.calls[1][0].items[3].displayText).toBe("おやすみ★");
  });

  it("先頭の編集を承認後の残りに流用しない", async () => {
    const { generate, items, getListener } = setup("preview_approval");
    fireEvent.click(screen.getByRole("button", { name: "画像 1 を再生成" }));
    fireEvent.change(screen.getByLabelText("追加の指示（任意・500文字以内）"), { target: { value: "朝日を右上に" } });
    fireEvent.change(screen.getByLabelText("画像に描く文字"), { target: { value: "朝だよ！" } });
    fireEvent.click(screen.getByLabelText("文字を入れる"));
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate.mock.calls[0][0]).toMatchObject({ count: 1, startIndex: 0 });
    await act(async () => {
      getListener()?.({ streamId: "run-1", event: "progress", data: { completed: 1, total: 1, latestImagePath: "new.png",
        index: 0, dataUrl: "data:image/png;base64,new", error: null } });
      getListener()?.({ streamId: "run-1", event: "done", data: { status: "done", total: 1, succeeded: 1, failed: 0 } });
    });
    fireEvent.click(screen.getByRole("button", { name: "このスタイルで残りを生成する" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    const remaining = generate.mock.calls[1][0];
    expect(remaining).toMatchObject({ count: 7, startIndex: 1 });
    expect(remaining.items[0].additionalInstructions).toBe("朝日を右上に");
    expect(remaining.items[0]).toMatchObject({ textEnabled: false, displayText: "朝だよ！" });
    expect(remaining.items[1]).toEqual(apiItem(items[1]));
  });
});
