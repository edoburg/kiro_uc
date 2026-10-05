import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppInner } from "../App";
import { AppStoreProvider, initialAppState } from "../stores/appStore";
import { createStampPlan } from "../utils/stampPlan";
import { createPresetSnapshot } from "../utils/generationPreset";
import type { Config, GenerationPreset, GenerationPresetSave } from "../types";
import type { GenerationStreamPayload } from "../types/ipc";

afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(window, "api", { configurable: true, value: undefined }); });
const config: Config = { aiEngine: "openai", outputDirectory: "C:/out", openaiModel: "gpt-image-2.5-flare", openaiQuality: "low", sdEndpoint: "" };
const preset: GenerationPreset = { schemaVersion: 1, id: "00d72f00-a155-4e05-97ae-8c6765ba6647", name: "仕事用", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", ...createPresetSnapshot({ prompt: "眠そうなアザラシ", theme: "work", count: 8, mode: "preview_approval", style: "ゆるい", items: createStampPlan("work", 8).reverse().map((item, position) => ({ ...item, position, textEnabled: position !== 0, displayText: position === 0 ? "" : position === 1 ? "任意文字" : null, additionalInstructions: "文字を顔に重ねない" })) }, { model: "gpt-image-2.5-sunburst", quality: "max" }) };
function setup(review = false) {
  let listener: ((payload: GenerationStreamPayload) => void) | undefined;
  const generate = vi.fn().mockResolvedValue({ streamId: "new-run" });
  const api = {
    generationPresets: {
      list: vi.fn().mockResolvedValue({ presets: [{ ...preset, count: 8, theme: "work" }], issues: [] }),
      load: vi.fn().mockResolvedValue(preset),
      save: vi.fn().mockImplementation(async (input: GenerationPresetSave) => ({ ...preset, ...input.snapshot, name: input.name })),
      delete: vi.fn(),
    },
    image: { generate }, onGenerateProgress: vi.fn().mockImplementation((callback: (payload: GenerationStreamPayload) => void) => { listener = callback; return vi.fn(); }),
    config: { get: vi.fn().mockResolvedValue(config), save: vi.fn() },
    credential: { get: vi.fn().mockResolvedValue({ configured: true }) },
  };
  Object.defineProperty(window, "api", { configurable: true, value: api });
  render(<AppStoreProvider initialState={{ ...initialAppState, needsSetup: false, aiApiKeyConfigured: true, config,
    ...(review ? { step: "preview", currentRequest: preset.request, generatedImages: [{ index: 0, itemId: preset.request.items![0].id, dataUrl: "data:image/png;base64,old", tempFilePath: "old.png", status: "done" }] } : {}) }}><AppInner /></AppStoreProvider>);
  return { ...api, getListener: () => listener };
}
async function ready() {
  fireEvent.click(screen.getByRole("button", { name: "生成設定の保存と読み込み" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "仕事用を読み込み" })).toBeEnabled());
}

describe("Appで生成設定を再利用する", () => {
  it("読込だけで生成せず、全項目・順序とモデル品質を次の要求へ渡す", async () => {
    const api = setup(true); await ready(); vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "仕事用を読み込み" }));
    await waitFor(() => expect(screen.getByLabelText("共通設定（キャラクターの外見・画風）")).toHaveValue(preset.request.prompt));
    expect(screen.queryByAltText("生成されたスタンプ画像 1")).not.toBeInTheDocument();
    expect(api.image.generate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("作業の生成モデル")).toHaveValue(preset.options.model);
    expect(screen.getByLabelText("作業の生成品質")).toHaveValue(preset.options.quality);
    expect(api.config.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    expect(within(screen.getByRole("group", { name: "1枚目" })).getByLabelText("伝えたい言葉／意味")).toHaveValue(preset.request.items![0].meaning);
    expect(within(screen.getByRole("group", { name: "1枚目" })).getByLabelText("文字を入れる")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));
    await waitFor(() => expect(api.image.generate).toHaveBeenCalledTimes(1));
    expect(api.image.generate.mock.calls[0][0]).toMatchObject({ count: 1, startIndex: 0, model: preset.options.model, quality: preset.options.quality, items: preset.request.items });
    expect(screen.getByRole("button", { name: "仕事用を読み込み" })).toBeDisabled();
  });
  it("共通入力と企画編集の最新ドラフトを生成せずに保存する", async () => {
    const api = setup(); await ready();
    fireEvent.change(screen.getByLabelText("共通設定（キャラクターの外見・画風）"), { target: { value: "共通設定の編集中" } });
    fireEvent.change(screen.getByLabelText("生成設定の保存名"), { target: { value: "入力下書き" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を付けて保存" }));
    await waitFor(() => expect(api.generationPresets.save).toHaveBeenCalledTimes(1));
    expect(api.generationPresets.save.mock.calls[0][0].snapshot.request.prompt).toBe("共通設定の編集中");
    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    const fourth = screen.getByRole("group", { name: "4枚目" });
    fireEvent.change(within(fourth).getByLabelText("ポーズ"), { target: { value: "仰向けで眠る" } });
    fireEvent.change(within(fourth).getByLabelText("追加の指示（任意・500文字以内）"), { target: { value: "青い毛布" } });
    fireEvent.change(within(fourth).getByLabelText("画像に描く文字"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を付けて保存" }));
    await waitFor(() => expect(api.generationPresets.save).toHaveBeenCalledTimes(2));
    expect(api.generationPresets.save.mock.calls[1][0].snapshot.request.items[3]).toMatchObject({ pose: "仰向けで眠る", additionalInstructions: "青い毛布", displayText: "" });
    expect(api.image.generate).not.toHaveBeenCalled();
  });
  it("レビューの未確定編集を保存へ混ぜず、確定済みの条件を保存する", async () => {
    const api = setup(true); await ready();
    fireEvent.click(screen.getByRole("button", { name: "画像 1 を大きく表示" }));
    fireEvent.change(screen.getByLabelText("ポーズ"), { target: { value: "未確定のポーズ" } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "閉じる" }));
    fireEvent.change(screen.getByLabelText("生成設定の保存名"), { target: { value: "レビュー設定" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を付けて保存" }));
    await waitFor(() => expect(api.generationPresets.save).toHaveBeenCalledTimes(1));
    expect(api.generationPresets.save.mock.calls[0][0].snapshot.request.items[0].pose).toBe(preset.request.items![0].pose);
    expect(api.image.generate).not.toHaveBeenCalled();
  });
  it("非同期読込中に生成を始めず、読込失敗でも既存の画像と条件を保持する", async () => {
    const api = setup(true); await ready();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let reject!: (reason: Error) => void;
    api.generationPresets.load.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    fireEvent.click(screen.getByRole("button", { name: "仕事用を読み込み" }));
    expect(screen.getByRole("button", { name: "画像 1 を再生成" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "スタンプを作る" })).toBeDisabled();
    await act(async () => reject(new Error("未知のバージョン")));
    expect(screen.getByAltText("生成されたスタンプ画像 1")).toHaveAttribute("src", "data:image/png;base64,old");
    expect(api.image.generate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("未知のバージョン");
  });
  it("レビューで確定した再生成条件は失敗後も保存でき、旧画像を保存しない", async () => {
    const api = setup(true); await ready();
    fireEvent.click(screen.getByRole("button", { name: "画像 1 を再生成" }));
    fireEvent.change(screen.getByLabelText("ポーズ"), { target: { value: "保存したい編集済みポーズ" } });
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    await waitFor(() => expect(api.image.generate).toHaveBeenCalledTimes(1));
    await act(async () => api.getListener()?.({ streamId: "new-run", event: "done", data: { status: "failed", total: 1, succeeded: 0, failed: 1 } }));
    fireEvent.change(screen.getByLabelText("生成設定の保存名"), { target: { value: "再試行の条件" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を付けて保存" }));
    await waitFor(() => expect(api.generationPresets.save).toHaveBeenCalledTimes(1));
    const input = api.generationPresets.save.mock.calls[0][0];
    expect(input.snapshot.request.items[0].pose).toBe("保存したい編集済みポーズ");
    expect(JSON.stringify(input)).not.toContain("old.png");
    expect(JSON.stringify(input)).not.toContain("data:image");
    expect(screen.getByAltText("生成されたスタンプ画像 1")).toHaveAttribute("src", "data:image/png;base64,old");
  });
});
