import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppInner } from "../App";
import { AppStoreProvider, initialAppState } from "../stores/appStore";
import { createStampPlan } from "../utils/stampPlan";
import type { Config, GenerationRequest, ProcessedImageSet } from "../types/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "api", { configurable: true, value: undefined });
});

const config: Config = {
  aiEngine: "openai", outputDirectory: "C:/out", openaiModel: "gpt-image-2.5-flare",
  openaiQuality: "high", sdEndpoint: "",
};

/** 変換元パスごとに異なる派生画像を返す画像処理APIのモック。 */
function processed(sourcePath: string): ProcessedImageSet {
  const base = sourcePath.replace(/\.png$/, "");
  return {
    stampPath: `${base}_stamp.png`,
    mainImagePath: `${base}_main.png`,
    thumbnailPath: `${base}_thumb.png`,
    stampDataUrl: `data:image/png;base64,stamp-${base}`,
    mainImageDataUrl: `data:image/png;base64,main-${base}`,
    thumbnailDataUrl: `data:image/png;base64,thumb-${base}`,
    validation: { passed: true, sizeOk: true, formatOk: true, fileSizeOk: true, fileSizeExceeded: false, details: "適合" },
  };
}

function setup() {
  const items = createStampPlan("daily", 8);
  const request: GenerationRequest = { prompt: "白いアザラシ", count: 8, mode: "batch", theme: "daily", items };
  const generatedImages = items.map((item, index) => ({
    index, itemId: item.id, dataUrl: `data:image/png;base64,original-${index}`,
    tempFilePath: `image-${index}.png`, status: "done" as const,
  }));
  const api = {
    image: {
      generate: vi.fn(),
      process: vi.fn(async (sourcePath: string) => processed(sourcePath)),
    },
    archive: {
      create: vi.fn().mockResolvedValue({ zipPath: "C:/out/a.zip", fileName: "a.zip", imageCount: 8 }),
    },
    onGenerateProgress: vi.fn(() => vi.fn()),
    config: { get: vi.fn().mockResolvedValue(config) },
    credential: { get: vi.fn().mockResolvedValue({ configured: true }) },
  };
  Object.defineProperty(window, "api", { configurable: true, value: api });
  render(
    <AppStoreProvider initialState={{ ...initialAppState, config, needsSetup: false, aiApiKeyConfigured: true,
      currentRequest: request, generatedImages, step: "preview" }}>
      <AppInner />
    </AppStoreProvider>,
  );
  return { api, items };
}

async function openEditor(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "スタンプセットを編集する" }));
  await screen.findByRole("region", { name: "メイン画像とトークルームタブ画像" });
  fireEvent.change(screen.getByLabelText("タイトル（1〜40文字）"), { target: { value: "テスト" } });
}

function summary(): HTMLElement {
  return screen.getByRole("region", { name: "メイン画像とトークルームタブ画像" });
}

describe("Appのメイン画像・タブ画像選択", () => {
  it("初期値は先頭画像。3枚目と5枚目を選ぶと画面とZIP要求が一致し、選択では生成・再変換しない", async () => {
    const { api, items } = setup();
    await openEditor();
    expect(api.image.process).toHaveBeenCalledTimes(8);
    expect(within(summary()).getByAltText("選択中のメイン画像（スタンプ 1）"))
      .toHaveAttribute("src", "data:image/png;base64,main-image-0");

    fireEvent.click(screen.getByRole("button", { name: "スタンプ 3 をメイン画像に使う" }));
    fireEvent.click(screen.getByRole("button", { name: "スタンプ 5 をタブ画像に使う" }));

    // 元画像（original-*）ではなく派生画像を表示する
    expect(within(summary()).getByAltText("選択中のメイン画像（スタンプ 3）"))
      .toHaveAttribute("src", "data:image/png;base64,main-image-2");
    expect(within(summary()).getByAltText("選択中のトークルームタブ画像（スタンプ 5）"))
      .toHaveAttribute("src", "data:image/png;base64,thumb-image-4");
    expect(api.image.process).toHaveBeenCalledTimes(8);
    expect(api.image.generate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "エクスポート（ZIP保存）" }));
    await waitFor(() => expect(api.archive.create).toHaveBeenCalledTimes(1));
    const exportRequest = api.archive.create.mock.calls[0][0];
    expect(exportRequest.stampSet.mainImageId).toBe(items[2].id);
    expect(exportRequest.stampSet.tabImageId).toBe(items[4].id);
    expect(exportRequest.stampSet.images.map((image: { stampPath: string }) => image.stampPath))
      .toEqual(items.map((_, index) => `image-${index}_stamp.png`));
    const main = exportRequest.stampSet.images.find((image: { id: string }) => image.id === items[2].id);
    const tab = exportRequest.stampSet.images.find((image: { id: string }) => image.id === items[4].id);
    expect(main.mainImagePath).toBe("image-2_main.png");
    expect(tab.thumbnailPath).toBe("image-4_thumb.png");
  });

  it("選択画像をPNGで差し替えると同じ枠IDのまま新しい派生画像を参照する", async () => {
    const { api, items } = setup();
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "スタンプ 3 をメイン画像に使う" }));

    const item = screen.getByRole("button", { name: "スタンプ画像 3 を差し替え" }).closest("li") as HTMLElement;
    const file = new File(["png"], "replacement.png", { type: "image/png" });
    Object.defineProperty(file, "path", { value: "replacement.png" });
    await act(async () => {
      fireEvent.change(item.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    });

    await waitFor(() =>
      expect(within(summary()).getByAltText("選択中のメイン画像（スタンプ 3）"))
        .toHaveAttribute("src", "data:image/png;base64,main-replacement"),
    );
    expect(api.image.process).toHaveBeenLastCalledWith("replacement.png");

    fireEvent.click(screen.getByRole("button", { name: "エクスポート（ZIP保存）" }));
    await waitFor(() => expect(api.archive.create).toHaveBeenCalledTimes(1));
    const exportRequest = api.archive.create.mock.calls[0][0];
    expect(exportRequest.stampSet.mainImageId).toBe(items[2].id);
    expect(exportRequest.stampSet.images[2]).toMatchObject({ id: items[2].id, mainImagePath: "replacement_main.png" });
  });

  it("選択画像を削除すると未選択になり、再選択するまでZIP保存できない", async () => {
    const { api } = setup();
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "スタンプ 3 をメイン画像に使う" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(screen.getByRole("button", { name: "スタンプ画像 3 を削除" }));

    expect(summary()).toHaveTextContent("メイン画像が選択されていません");
    const exportButton = screen.getByRole("button", { name: "エクスポート（ZIP保存）" });
    expect(exportButton).toBeDisabled();
    // タブ画像は先頭画像のまま（別画像へ黙って切り替えない）
    expect(within(summary()).getByAltText("選択中のトークルームタブ画像（スタンプ 1）")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "スタンプ 4 をメイン画像に使う" }));
    expect(exportButton).toBeEnabled();
    expect(api.image.generate).not.toHaveBeenCalled();
  });
});
