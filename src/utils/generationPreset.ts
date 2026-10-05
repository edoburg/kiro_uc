import type { GenerationOptions, GenerationPreset, GenerationPresetSnapshot, GenerationRequest, StampPlanItem } from "../types";

export const PRESET_MAX_BYTES = 256 * 1024;
export const PRESET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const GENERATION_MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const;
export const GENERATION_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;

function fail(): never { throw new Error("生成設定の形式または文字数が不正です。"); }
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !keys.includes(key))) fail();
  return data;
}
function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) fail();
  return value;
}
function choice<T extends string | number>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) fail();
  return value as T;
}
export function validatePresetId(value: unknown): string {
  if (typeof value !== "string" || !PRESET_ID_PATTERN.test(value)) throw new Error("生成設定のIDが不正です。");
  return value;
}
export function validatePresetName(value: unknown): string {
  const name = string(value, 100).trim();
  if (!name || Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error("保存名は1～100文字で入力してください。");
  return name;
}
function itemId(value: unknown): string {
  const id = string(value, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(id)) fail();
  return id;
}

/** 保存用の構造検証。下書きの空欄や意味の重複は許容し、生成可能性はvalidateStampPlanで検証する。 */
export function parsePresetSnapshot(value: unknown): GenerationPresetSnapshot {
  const data = object(value, ["request", "options"]);
  const options = object(data.options, ["model", "quality"]);
  const request = object(data.request, ["prompt", "theme", "count", "style", "mode", "items"]);
  const count = choice(request.count, [8, 16, 24, 32, 40] as const);
  if (!Array.isArray(request.items) || request.items.length !== count) fail();
  const ids = new Set<string>();
  const items = request.items.map((value, position): StampPlanItem => {
    const item = object(value, ["id", "position", "meaning", "expression", "pose", "prop", "additionalInstructions", "textEnabled", "displayText", "sourceTemplateId"]);
    const id = itemId(item.id);
    if (ids.has(id) || item.position !== position) fail();
    ids.add(id);
    if (item.textEnabled !== undefined && typeof item.textEnabled !== "boolean") fail();
    const displayText = item.displayText === undefined || item.displayText === null ? null : string(item.displayText, 200);
    if (displayText !== null && Array.from(displayText).length > 100) fail();
    return {
      id, position, meaning: string(item.meaning, 100), expression: string(item.expression, 100),
      pose: string(item.pose, 100), prop: string(item.prop, 100),
      additionalInstructions: item.additionalInstructions === undefined ? "" : string(item.additionalInstructions, 500),
      textEnabled: item.textEnabled === undefined ? false : item.textEnabled,
      displayText,
      ...(item.sourceTemplateId === undefined ? {} : { sourceTemplateId: itemId(item.sourceTemplateId) }),
    };
  });
  return {
    request: {
      prompt: string(request.prompt, 1000), count,
      theme: choice(request.theme, ["daily", "work"] as const),
      mode: choice(request.mode, ["batch", "preview_approval"] as const), items,
      ...(request.style === undefined ? {} : { style: choice(request.style, ["かわいい", "クール", "ゆるい", "リアル"] as const) }),
    },
    options: { model: choice(options.model, GENERATION_MODELS), quality: choice(options.quality, GENERATION_QUALITIES) },
  };
}

/** 許可した条件だけを抽出し、認証情報・画像・実行情報は保存しない。 */
export function createPresetSnapshot(request: GenerationRequest, options: GenerationOptions): GenerationPresetSnapshot {
  return parsePresetSnapshot({
    request: {
      prompt: request.prompt, count: request.count, theme: request.theme ?? "daily", mode: request.mode,
      ...(request.style === undefined ? {} : { style: request.style }),
      items: request.items?.map((item) => ({
        id: item.id, position: item.position, meaning: item.meaning, expression: item.expression,
        pose: item.pose, prop: item.prop, additionalInstructions: item.additionalInstructions,
        textEnabled: item.textEnabled, displayText: item.displayText, sourceTemplateId: item.sourceTemplateId,
      })),
    },
    options: { model: options.model, quality: options.quality },
  });
}

export function parseGenerationPreset(value: unknown): GenerationPreset {
  const data = object(value, ["schemaVersion", "id", "name", "createdAt", "updatedAt", "request", "options"]);
  if (data.schemaVersion !== 1) throw new Error("この生成設定のバージョンには対応していません。");
  const date = (value: unknown) => {
    const text = string(value, 30);
    if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) fail();
    return text;
  };
  const createdAt = date(data.createdAt), updatedAt = date(data.updatedAt);
  if (createdAt > updatedAt) fail();
  return { schemaVersion: 1, id: validatePresetId(data.id), name: validatePresetName(data.name), createdAt, updatedAt,
    ...parsePresetSnapshot({ request: data.request, options: data.options }) };
}
