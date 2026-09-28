import { describe, expect, it } from "vitest";
import type { Config, GenerationRequest } from "../types/index";
import {
  classifyGenerationOutcome,
  toGenerationStartRequest,
} from "../utils/generationFlow";

const request: GenerationRequest = {
  prompt: "青い毛玉",
  count: 8,
  style: "かわいい",
  mode: "preview_approval",
};

const config: Config = {
  aiEngine: "openai",
  outputDirectory: "C:/out",
  openaiModel: "gpt-image-2.5-sunburst",
  openaiQuality: "xhigh",
  sdEndpoint: "",
};

describe("生成処理要求", () => {
  it("個別再生成は1枚だけを対象indexへ要求する", () => {
    expect(
      toGenerationStartRequest(request, config, {
        count: 1,
        startIndex: 4,
        mode: "batch",
      }),
    ).toMatchObject({
      count: 1,
      startIndex: 4,
      mode: "batch",
      model: "gpt-image-2.5-sunburst",
      quality: "xhigh",
    });
  });

  it("承認後の残り生成はindex 1から開始する", () => {
    const result = toGenerationStartRequest(request, config, {
      count: 7,
      startIndex: 1,
      mode: "batch",
    });
    expect(result.count).toBe(7);
    expect(result.startIndex).toBe(1);
  });
});

describe("生成完了状態", () => {
  it.each([
    [{ status: "done", total: 2, succeeded: 2, failed: 0 } as const, 0, 2, "complete"],
    [{ status: "partial", total: 2, succeeded: 1, failed: 1 } as const, 0, 2, "partial"],
    [{ status: "failed", total: 2, succeeded: 0, failed: 2 } as const, 0, 2, "failed"],
    [{ status: "done", total: 1, succeeded: 1, failed: 0 } as const, 7, 8, "complete"],
  ])("成功・一部失敗・全件失敗を区別する", (done, baseline, required, expected) => {
    expect(classifyGenerationOutcome(done, baseline, required)).toBe(expected);
  });
});
