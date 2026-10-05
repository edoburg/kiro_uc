import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import GenerationPresetPanel from "../components/GenerationPresetPanel";
import { createStampPlan } from "../utils/stampPlan";
import { createPresetSnapshot } from "../utils/generationPreset";
import type { GenerationPreset, GenerationPresetSave } from "../types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(window, "api", { configurable: true, value: undefined }); });
const request = { prompt: "白いアザラシ", theme: "daily" as const, count: 8 as const, mode: "batch" as const, items: createStampPlan("daily", 8) };
const options = { model: "gpt-image-2.5-sunburst" as const, quality: "max" as const };
const preset: GenerationPreset = { schemaVersion: 1, id: "00d72f00-a155-4e05-97ae-8c6765ba6647", name: "仕事用", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", ...createPresetSnapshot(request, options) };
function setup() {
  const api = {
    list: vi.fn().mockResolvedValue({ presets: [{ ...preset, count: 8, theme: "daily" }], issues: [] }),
    load: vi.fn().mockResolvedValue(preset),
    save: vi.fn().mockImplementation(async (input: GenerationPresetSave) => ({ ...preset, ...input.snapshot, name: input.name })),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, "api", { configurable: true, value: { generationPresets: api } });
  const props = { request, options, locked: false, hasResults: true, onOptionsChange: vi.fn(), onLoad: vi.fn().mockReturnValue(true), onBusyChange: vi.fn() };
  const view = render(<GenerationPresetPanel {...props} />);
  return { api, props, ...view };
}
async function ready() {
  const toggle = screen.getByRole("button", { name: "生成設定の保存と読み込み" });
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  await waitFor(() => expect(screen.getByRole("button", { name: "名前を付けて保存" })).toBeEnabled());
}

describe("生成設定ライブラリの操作", () => {
  it("名前を付けて保存と上書きを区別し、保存成功前は保存済みにしない", async () => {
    const { api } = setup(); await ready();
    let resolve!: (value: GenerationPreset) => void;
    api.save.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.change(screen.getByLabelText("生成設定の保存名"), { target: { value: "日本語の保存名" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を付けて保存" }));
    expect(screen.getByRole("status")).toHaveTextContent("保存中");
    expect(screen.getByText("未保存の変更があります")).toBeInTheDocument();
    expect(api.save.mock.calls[0][0]).not.toHaveProperty("id");
    await act(async () => resolve({ ...preset, name: "日本語の保存名" }));
    expect(screen.getByText("選択中：日本語の保存名 ／ 保存済み")).toBeInTheDocument();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "上書き保存" }));
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "この設定を上書きする" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "上書きをキャンセル" }));
    expect(screen.getByLabelText("生成設定の保存名")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "上書き保存" }));
    fireEvent.click(screen.getByRole("button", { name: "この設定を上書きする" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    await ready();
    expect(screen.getByLabelText("生成設定の保存名")).toHaveFocus();
    expect(confirm).not.toHaveBeenCalled();
    expect(api.save.mock.calls[1][0].id).toBe(preset.id);
  });
  it("読み込みの破棄確認をキャンセルすれば作業を変更しない", async () => {
    const { api, props } = setup(); await ready();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "仕事用を読み込み" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("生成画像・変換結果"));
    expect(api.load).not.toHaveBeenCalled(); expect(props.onLoad).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "仕事用を読み込み" }));
    await waitFor(() => expect(props.onLoad).toHaveBeenCalledWith(preset));
  });
  it("保存済みの別名コピーは現在の作業を切り替えず、削除は確認する", async () => {
    const { api, props } = setup(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "仕事用を別名保存" }));
    fireEvent.click(screen.getByRole("button", { name: "別名保存をキャンセル" }));
    expect(api.save).not.toHaveBeenCalled();
    expect(api.load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "仕事用を別名保存" }));
    fireEvent.change(screen.getByLabelText("別名の保存名"), { target: { value: "別名コピー" } });
    fireEvent.click(screen.getByRole("button", { name: "この名前でコピーを保存" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ name: "別名コピー", snapshot: createPresetSnapshot(preset.request, preset.options) }));
    expect(props.onLoad).not.toHaveBeenCalled(); await ready();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "仕事用を削除" }));
    expect(api.delete).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole("button", { name: "仕事用を削除" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(preset.id));
  });
  it("保存・読込失敗では成功状態へ遷移せず元の作業を保持する", async () => {
    const { api, props } = setup(); await ready();
    fireEvent.change(screen.getByLabelText("生成設定の保存名"), { target: { value: "失敗設定" } });
    api.save.mockRejectedValueOnce(new Error("保存に失敗しました"));
    fireEvent.click(screen.getByRole("button", { name: "名前を付けて保存" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保存に失敗"));
    expect(screen.getByRole("button", { name: "上書き保存" })).toBeDisabled();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.load.mockRejectedValueOnce(new Error("破損しています"));
    fireEvent.click(screen.getByRole("button", { name: "仕事用を読み込み" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("破損"));
    expect(props.onLoad).not.toHaveBeenCalled();
  });
  it("生成中は保存・読み込みとモデル切替を禁止する", async () => {
    const { api, props, rerender } = setup(); await ready();
    rerender(<GenerationPresetPanel {...props} locked />);
    expect(screen.getByRole("button", { name: "仕事用を読み込み" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "名前を付けて保存" })).toBeDisabled();
    expect(screen.getByLabelText("作業の生成モデル")).toBeDisabled();
    expect(api.load).not.toHaveBeenCalled();
  });
  it("別名が空欄なら読込・書込せず、保存失敗時は入力を保持して再試行できる", async () => {
    const { api, props } = setup(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "仕事用を別名保存" }));
    expect(screen.getByLabelText("別名の保存名")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("別名の保存名"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "この名前でコピーを保存" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保存名"));
    expect(api.load).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("別名の保存名"), { target: { value: "再試行用の名前" } });
    api.save.mockRejectedValueOnce(new Error("書込失敗"));
    fireEvent.click(screen.getByRole("button", { name: "この名前でコピーを保存" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("書込失敗"));
    expect(screen.getByLabelText("別名の保存名")).toHaveValue("再試行用の名前");
    expect(props.onLoad).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "この名前でコピーを保存" }));
    await waitFor(() => expect(screen.queryByLabelText("別名の保存名")).not.toBeInTheDocument());
    expect(api.save).toHaveBeenCalledTimes(2);
  });
});
