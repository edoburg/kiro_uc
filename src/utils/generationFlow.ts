import type {
  Config,
  GenerationMode,
  GenerationRequest,
  GenerationStartRequest,
} from "../types/index";
import type { GenerationDonePayload } from "../types/ipc";
import { normalizeStampPlanItem } from "./stampPlan";

export interface GenerationSlice {
  count: number;
  startIndex: number;
  mode?: GenerationMode;
}

/** UI上の要求と設定から、1回のバックエンド生成要求を組み立てる。 */
export function toGenerationStartRequest(
  request: GenerationRequest,
  config: Pick<Config, "openaiModel" | "openaiQuality"> | null,
  slice: GenerationSlice,
): GenerationStartRequest {
  return {
    ...request,
    ...(request.items ? { items: request.items.map((item) => {
      const { sourceTemplateId: _sourceTemplateId, ...condition } = normalizeStampPlanItem(item);
      return condition;
    }) } : {}),
    count: slice.count,
    startIndex: slice.startIndex,
    mode: slice.mode ?? request.mode,
    model: config?.openaiModel ?? "gpt-image-2.5-flare",
    quality: config?.openaiQuality ?? "auto",
  };
}

export type GenerationOutcome = "complete" | "partial" | "failed";

/** 今回より前の成功枚数も含め、生成フロー全体の完了状態を判定する。 */
export function classifyGenerationOutcome(
  done: GenerationDonePayload,
  baselineSucceeded: number,
  requiredSucceeded: number,
): GenerationOutcome {
  const succeeded = baselineSucceeded + done.succeeded;
  if (done.status === "failed" && succeeded === 0) {
    return "failed";
  }
  if (done.status !== "done" || succeeded < requiredSucceeded) {
    return "partial";
  }
  return "complete";
}
