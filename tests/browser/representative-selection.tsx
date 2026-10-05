/**
 * メイン／タブ画像選択の実ブラウザー検証用ハーネス。
 * 画像処理APIはPython側で実際に変換した結果（fixtures.json）を返すモックで、
 * 画像生成API・LINE送信は呼ばない。ZIP要求は window.__checks に記録する。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { AppInner } from "../../src/App";
import { AppStoreProvider, initialAppState } from "../../src/stores/appStore";
import { createStampPlan } from "../../src/utils/stampPlan";
import type { Config, GenerationRequest, ProcessedImageSet } from "../../src/types/index";
import type { ExportCreateRequest } from "../../src/types/ipc";
import "../../src/styles.css";

interface Fixture {
  sourcePath: string;
  originalDataUrl: string;
  processed: ProcessedImageSet;
}

interface Checks {
  processCalls: string[];
  generateCalls: number;
  exportRequests: ExportCreateRequest[];
}

declare global {
  interface Window {
    __checks: Checks;
  }
}

const fixtures: Fixture[] = await fetch("/.pytest_cache/representative-selection/fixtures.json").then(
  (response) => response.json(),
);
const checks: Checks = { processCalls: [], generateCalls: 0, exportRequests: [] };
window.__checks = checks;

const config: Config = {
  aiEngine: "openai",
  outputDirectory: "",
  openaiModel: "gpt-image-2.5-flare",
  openaiQuality: "auto",
  sdEndpoint: "",
};
const api = {
  image: {
    generate: async () => {
      checks.generateCalls += 1;
      throw new Error("検証では画像生成APIを呼びません。");
    },
    process: async (sourcePath: string) => {
      checks.processCalls.push(sourcePath);
      const fixture = fixtures.find((item) => item.sourcePath === sourcePath);
      if (!fixture) throw new Error(`未知の画像です: ${sourcePath}`);
      return fixture.processed;
    },
  },
  archive: {
    create: async (request: ExportCreateRequest) => {
      checks.exportRequests.push(request);
      return { zipPath: "", fileName: "check.zip", imageCount: request.stampSet.images.length };
    },
  },
  onGenerateProgress: () => () => undefined,
  config: { get: async () => config },
  credential: { get: async (key: string) => ({ key, configured: true }) },
};
Object.defineProperty(window, "api", { configurable: true, value: api });

const items = createStampPlan("daily", 8);
const request: GenerationRequest = { prompt: "検証用", count: 8, mode: "batch", theme: "daily", items };
const generatedImages = fixtures.map((fixture, index) => ({
  index,
  itemId: items[index].id,
  dataUrl: fixture.originalDataUrl,
  tempFilePath: fixture.sourcePath,
  status: "done" as const,
}));

createRoot(document.getElementById("root")!).render(
  <AppStoreProvider
    initialState={{
      ...initialAppState,
      config,
      needsSetup: false,
      aiApiKeyConfigured: true,
      currentRequest: request,
      generatedImages,
      step: "preview",
    }}
  >
    <AppInner />
  </AppStoreProvider>,
);
