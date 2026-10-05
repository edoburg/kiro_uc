import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { GenerationPreset, GenerationPresetList, GenerationPresetSave } from "../src/types";
import { object, parseGenerationPreset, parsePresetSnapshot, PRESET_ID_PATTERN, PRESET_MAX_BYTES, validatePresetId, validatePresetName } from "../src/utils/generationPreset";

/** 限定IPCからのみ利用。保存名をパスに使わず、変更操作を直列化する。 */
export class GenerationPresetRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}

  private file(id: string) { return path.join(this.directory, `${validatePresetId(id)}.json`); }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }
  async load(id: string): Promise<GenerationPreset> {
    const file = this.file(id);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > PRESET_MAX_BYTES) throw new Error("生成設定のファイルが不正か、サイズ上限を超えています。");
      const bytes = await fs.readFile(file);
      if (bytes.length > PRESET_MAX_BYTES) throw new Error("生成設定のサイズ上限を超えています。");
      const preset = parseGenerationPreset(JSON.parse(bytes.toString("utf8")));
      if (preset.id !== id) throw new Error("生成設定のIDと保存ファイルが一致しません。");
      return preset;
    } catch (error) {
      if (error instanceof Error && !("code" in error) && !(error instanceof SyntaxError)) throw error;
      throw new Error("生成設定を読み込めません。ファイルの破損やアクセス権を確認してください。");
    }
  }
  async list(): Promise<GenerationPresetList> {
    let names: string[];
    try { await fs.mkdir(this.directory, { recursive: true }); names = await fs.readdir(this.directory); }
    catch { throw new Error("保存済み設定一覧を読み込めません。保存先のアクセス権を確認してください。"); }
    const result: GenerationPresetList = { presets: [], issues: [] };
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!PRESET_ID_PATTERN.test(id)) { result.issues.push({ message: "不正な保存IDのファイルがあります。" }); continue; }
      try {
        const preset = await this.load(id);
        result.presets.push({ id, name: preset.name, createdAt: preset.createdAt, updatedAt: preset.updatedAt,
          count: preset.request.count, theme: preset.request.theme ?? "daily" });
      } catch (error) { result.issues.push({ id, message: error instanceof Error ? error.message : "生成設定を読み込めません。" }); }
    }
    result.presets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return result;
  }
  save(input: GenerationPresetSave): Promise<GenerationPreset> {
    return this.mutate(async () => {
      const data = object(input, ["id", "name", "snapshot"]);
      const name = validatePresetName(data.name);
      const snapshot = parsePresetSnapshot(data.snapshot);
      const id = data.id === undefined ? randomUUID() : validatePresetId(data.id);
      const previous = data.id === undefined ? undefined : await this.load(id);
      const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
      const preset: GenerationPreset = { schemaVersion: 1, id, name, createdAt: previous?.createdAt ?? now, updatedAt: now, ...snapshot };
      const json = JSON.stringify(preset, null, 2);
      if (Buffer.byteLength(json, "utf8") > PRESET_MAX_BYTES) throw new Error("生成設定のサイズ上限を超えています。");
      const temporary = path.join(this.directory, `${id}-${randomUUID()}.tmp`);
      try {
        await fs.mkdir(this.directory, { recursive: true });
        const handle = await fs.open(temporary, "wx");
        try { await handle.writeFile(json, "utf8"); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, this.file(id));
      } catch {
        throw new Error("生成設定を保存できませんでした。元の設定は保持されています。空き容量やアクセス権を確認してください。");
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return preset;
    });
  }
  delete(id: string): Promise<void> {
    return this.mutate(async () => {
      try { await fs.unlink(this.file(id)); }
      catch { throw new Error("生成設定を削除できません。アクセス権やファイルの存在を確認してください。"); }
    });
  }
}
