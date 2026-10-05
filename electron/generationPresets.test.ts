// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { GenerationPresetRepository } from "./generationPresets";
import { createPresetSnapshot, PRESET_MAX_BYTES } from "../src/utils/generationPreset";
import { createStampPlan } from "../src/utils/stampPlan";
import type { GenerationPresetSave } from "../src/types";

let directory: string;
let repository: GenerationPresetRepository;
function input(): GenerationPresetSave {
  const items = createStampPlan("work", 8).reverse().map((item, position) => ({ ...item, position, sourceTemplateId: `template-${position}` }));
  items[0] = { ...items[0], textEnabled: false, displayText: "", additionalInstructions: "顔を隠さない" };
  items[1] = { ...items[1], textEnabled: true, displayText: null };
  items[2] = { ...items[2], textEnabled: true, displayText: "ありがとう★" };
  return { name: "アザラシ／仕事用", snapshot: createPresetSnapshot({ prompt: "白いアザラシ", count: 8, mode: "preview_approval", theme: "work", style: "ゆるい", items }, { model: "gpt-image-2.5-sunburst", quality: "max" }) };
}
beforeEach(async () => {
  const root = path.join(process.cwd(), ".pytest_cache", "preset-tests");
  await fs.mkdir(root, { recursive: true });
  directory = await fs.mkdtemp(path.join(root, "repository-"));
  repository = new GenerationPresetRepository(directory);
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });

describe("生成設定の永続化", () => {
  it("日本語名と全項目・順序・null/空文字/falseを、新しいリポジトリから復元する", async () => {
    const source = input();
    const saved = await repository.save(source);
    const restarted = new GenerationPresetRepository(directory);
    expect(await restarted.load(saved.id)).toEqual(saved);
    expect(saved.request).toEqual(source.snapshot.request);
    expect(saved.options).toEqual(source.snapshot.options);
    expect(await fs.readdir(directory)).toEqual([`${saved.id}.json`]);
    expect((await restarted.list()).presets[0]).toMatchObject({ name: source.name, count: 8, theme: "work" });
  });

  it("上書きでIDと作成日時を維持し、別名保存は別IDになり、削除が永続化する", async () => {
    const saved = await repository.save(input());
    const updated = await repository.save({ ...input(), id: saved.id, name: "改訂版" });
    expect(updated.id).toBe(saved.id);
    expect(updated.createdAt).toBe(saved.createdAt);
    expect(updated.updatedAt > saved.updatedAt).toBe(true);
    const copy = await repository.save({ ...input(), name: "コピー" });
    expect(copy.id).not.toBe(saved.id);
    await repository.delete(saved.id);
    expect((await new GenerationPresetRepository(directory).list()).presets.map((preset) => preset.id)).toEqual([copy.id]);
  });

  it("認証情報・画像・一時パス・接続情報をスナップショットへ持ち込まない", async () => {
    const source = input();
    const polluted = { ...source.snapshot.request, apiKey: "secret", dataUrl: "image-data", tempFilePath: "private-path", streamId: "stream", items: source.snapshot.request.items?.map((item) => ({ ...item, password: "secret" })) };
    const saved = await repository.save({ name: source.name, snapshot: createPresetSnapshot(polluted, source.snapshot.options) });
    const json = await fs.readFile(path.join(directory, `${saved.id}.json`), "utf8");
    for (const forbidden of ["secret", "apiKey", "password", "dataUrl", "tempFilePath", "streamId"]) expect(json).not.toContain(forbidden);
    await expect(repository.save({ ...source, snapshot: { ...source.snapshot, password: "secret" } } as GenerationPresetSave)).rejects.toThrow("形式");
  });

  it("原子的置換に失敗しても元データを残し、一時ファイルを削除して次回保存できる", async () => {
    const saved = await repository.save(input());
    const before = await fs.readFile(path.join(directory, `${saved.id}.json`));
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk failure"));
    await expect(repository.save({ ...input(), id: saved.id, name: "保存失敗" })).rejects.toThrow("元の設定は保持");
    expect(await fs.readFile(path.join(directory, `${saved.id}.json`))).toEqual(before);
    expect(await fs.readdir(directory)).toEqual([`${saved.id}.json`]);
    expect((await repository.save({ ...input(), id: saved.id, name: "再試行" })).name).toBe("再試行");
  });

  it("保存先が使用できない場合も日本語で案内する", async () => {
    vi.spyOn(fs, "mkdir").mockRejectedValue(new Error("denied"));
    await expect(repository.save(input())).rejects.toThrow("保存できません");
    await expect(repository.list()).rejects.toThrow("保存済み設定一覧を読み込めません");
  });

  it.each(["../outside", "", "not-an-id", "A".repeat(500)])("不正な保存ID %s は保存先外へアクセスさせない", async (id) => {
    await expect(repository.load(id)).rejects.toThrow("IDが不正");
    await expect(repository.save({ ...input(), id })).rejects.toThrow("IDが不正");
    await expect(repository.delete(id)).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("破損・未知バージョン・ID不一致・過大ファイルを隔離して正常設定を利用できる", async () => {
    const saved = await repository.save(input());
    const corrupt = randomUUID(), future = randomUUID(), mismatch = randomUUID(), large = randomUUID();
    await fs.writeFile(path.join(directory, `${corrupt}.json`), "{broken");
    await fs.writeFile(path.join(directory, `${future}.json`), JSON.stringify({ ...saved, id: future, schemaVersion: 2 }));
    await fs.writeFile(path.join(directory, `${mismatch}.json`), JSON.stringify(saved));
    await fs.writeFile(path.join(directory, `${large}.json`), " ".repeat(PRESET_MAX_BYTES + 1));
    await expect(repository.load(future)).rejects.toThrow("バージョン");
    await expect(repository.load(mismatch)).rejects.toThrow("一致しません");
    const list = await repository.list();
    expect(list.presets.map((preset) => preset.id)).toEqual([saved.id]);
    expect(list.issues).toHaveLength(4);
    expect(await repository.load(saved.id)).toEqual(saved);
    await expect(repository.save({ ...input(), id: corrupt })).rejects.toThrow();
    expect(await fs.readFile(path.join(directory, `${corrupt}.json`), "utf8")).toBe("{broken");
  });

  it("同時上書きを直列化し、最後の要求だけを破損なく保存する", async () => {
    const saved = await repository.save(input());
    await Promise.all([repository.save({ ...input(), id: saved.id, name: "1回目" }), repository.save({ ...input(), id: saved.id, name: "2回目" })]);
    expect((await repository.load(saved.id)).name).toBe("2回目");
    expect(await fs.readdir(directory)).toHaveLength(1);
  });
});
