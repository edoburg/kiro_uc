import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppInner } from "../App";
import { AppStoreProvider, initialAppState } from "../stores/appStore";
import type { Config, GenerationPreset, GenerationPresetSave } from "../types";
import type { GenerationStreamPayload } from "../types/ipc";

// 画像API・生成設定の保存はすべてモック。実際の有料画像APIやLINEへの送信は行わない。
afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(window, "api", { configurable: true, value: undefined }); });
const config: Config = { aiEngine: "openai", outputDirectory: "C:/out", openaiModel: "gpt-image-2.5-flare", openaiQuality: "low", sdEndpoint: "" };

function setup() {
  let listener: ((payload: GenerationStreamPayload) => void) | undefined;
  let saved: GenerationPreset | null = null;
  const generate = vi.fn()
    .mockResolvedValueOnce({ streamId: "run-1" })
    .mockResolvedValueOnce({ streamId: "run-2" })
    .mockResolvedValueOnce({ streamId: "run-3" });
  const api = {
    generationPresets: {
      list: vi.fn().mockImplementation(async () => ({ presets: saved ? [{ ...saved, count: saved.request.count, theme: saved.request.theme }] : [], issues: [] })),
      load: vi.fn().mockImplementation(async () => saved),
      save: vi.fn().mockImplementation(async (input: GenerationPresetSave) => {
        saved = { schemaVersion: 1, id: "00d72f00-a155-4e05-97ae-8c6765ba6647", name: input.name, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", ...input.snapshot };
        return saved;
      }),
      delete: vi.fn(),
    },
    image: { generate },
    onGenerateProgress: vi.fn().mockImplementation((callback: (payload: GenerationStreamPayload) => void) => { listener = callback; return vi.fn(); }),
    config: { get: vi.fn().mockResolvedValue(config), save: vi.fn() },
    credential: { get: vi.fn().mockResolvedValue({ configured: true }) },
  };
  Object.defineProperty(window, "api", { configurable: true, value: api });
  render(<AppStoreProvider initialState={{ ...initialAppState, needsSetup: false, aiApiKeyConfigured: true, config }}><AppInner /></AppStoreProvider>);
  return { ...api, getListener: () => listener };
}

const checkbox = (name: string) => screen.getByRole("checkbox", { name });
const next = () => screen.getByRole("button", { name: "企画の編集へ進む" });
const status = () => screen.getByText(/^選択中\d+／\d+件$/).parentElement!;

function openSelection(prompt = "白いアザラシ") {
  fireEvent.change(screen.getByLabelText("共通設定（キャラクターの外見・画風）"), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
}

/** 先頭8件のうち4件を外し、No.12・No.21・No.33・No.40 を選ぶ。 */
function chooseNonHeadSet() {
  for (const name of ["No.1 おはよう", "No.3 こんばんは", "No.6 いってらっしゃい", "No.8 おかえり"]) fireEvent.click(checkbox(name));
  for (const name of ["No.12 大丈夫", "No.21 がんばって", "No.33 元気？", "No.40 おやつの時間"]) fireEvent.click(checkbox(name));
}
const CHOSEN = ["こんにちは", "おやすみ", "いってきます", "ただいま", "大丈夫", "がんばって", "元気？", "おやつの時間"];

describe("テンプレート40件からの項目選択", () => {
  it("全40件を表示し、初期は先頭8件、上限超過を案内して他の選択を外さず、不足時は進めない", () => {
    setup(); openSelection();
    const list = screen.getByRole("list", { name: "テンプレート一覧" });
    expect(within(list).getAllByRole("checkbox")).toHaveLength(40);
    expect(within(list).getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked)).toHaveLength(8);
    expect(status()).toHaveTextContent("選択中8／8件");
    expect(screen.getByText(/生成順は選んだ順ではなく、テンプレートの番号順です/)).toBeInTheDocument();
    fireEvent.click(checkbox("No.40 おやつの時間"));
    expect(screen.getByRole("alert")).toHaveTextContent("選択できるのは8件までです。入れ替える場合は、先にほかの項目のチェックを外してください。");
    expect(checkbox("No.40 おやつの時間")).not.toBeChecked();
    expect(checkbox("No.1 おはよう")).toBeChecked();
    fireEvent.click(checkbox("No.1 おはよう"));
    expect(status()).toHaveTextContent("選択中7／8件 あと1件選んでください。");
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "選択を解除" }));
    expect(status()).toHaveTextContent("選択中0／8件 あと8件選んでください。");
    fireEvent.click(screen.getByRole("button", { name: "先頭8件に戻す" }));
    expect(status()).toHaveTextContent("選択中8／8件");
    expect(next()).toBeEnabled();
  });

  it("先頭以外と40番目の8件だけを位置0～7で生成し、承認後は残りの選択項目、個別再生成は正しい項目を対象にする", async () => {
    const api = setup();
    fireEvent.click(screen.getByLabelText("プレビュー承認モード"));
    openSelection(); chooseNonHeadSet();
    expect(status()).toHaveTextContent("選択中8／8件");
    fireEvent.click(next());
    const eighth = screen.getByRole("group", { name: "8枚目" });
    expect(within(eighth).getByLabelText("伝えたい言葉／意味")).toHaveValue("おやつの時間");
    expect(eighth).toHaveTextContent("元のテンプレート：No.40「おやつの時間」");
    expect(api.image.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));
    await waitFor(() => expect(api.image.generate).toHaveBeenCalledTimes(1));
    const first = api.image.generate.mock.calls[0][0];
    expect(first).toMatchObject({ count: 1, startIndex: 0, theme: "daily" });
    expect(first.items.map((item: { meaning: string }) => item.meaning)).toEqual(CHOSEN);
    expect(first.items.map((item: { position: number }) => item.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(first.items[7].id).toBe("plan-daily-t40");
    first.items.forEach((item: object) => expect(item).not.toHaveProperty("sourceTemplateId"));
    await act(async () => {
      api.getListener()?.({ streamId: "run-1", event: "progress", data: { completed: 1, total: 1, latestImagePath: "0.png", index: 0, dataUrl: "data:image/png;base64,0", error: null } });
      api.getListener()?.({ streamId: "run-1", event: "done", data: { status: "done", total: 1, succeeded: 1, failed: 0 } });
    });
    fireEvent.click(screen.getByRole("button", { name: "このスタイルで残りを生成する" }));
    await waitFor(() => expect(api.image.generate).toHaveBeenCalledTimes(2));
    expect(api.image.generate.mock.calls[1][0]).toMatchObject({ count: 7, startIndex: 1 });
    expect(api.image.generate.mock.calls[1][0].items.map((item: { meaning: string }) => item.meaning)).toEqual(CHOSEN);
    await act(async () => {
      for (let index = 1; index < 8; index += 1) {
        api.getListener()?.({ streamId: "run-2", event: "progress", data: { completed: index, total: 7, latestImagePath: `${index}.png`, index, dataUrl: `data:image/png;base64,${index}`, error: null } });
      }
      api.getListener()?.({ streamId: "run-2", event: "done", data: { status: "done", total: 7, succeeded: 7, failed: 0 } });
    });
    // 8枚目（カタログNo.40）の再生成は生成位置7を対象にし、No.40やカタログ位置39は使わない
    fireEvent.click(screen.getByRole("button", { name: "画像 8 を再生成" }));
    fireEvent.change(screen.getByLabelText("ポーズ"), { target: { value: "クッキーを掲げる" } });
    fireEvent.click(screen.getByRole("button", { name: "この内容で再生成" }));
    await waitFor(() => expect(api.image.generate).toHaveBeenCalledTimes(3));
    const regenerate = api.image.generate.mock.calls[2][0];
    expect(regenerate).toMatchObject({ count: 1, startIndex: 7 });
    expect(regenerate.items[7]).toMatchObject({ id: "plan-daily-t40", position: 7, meaning: "おやつの時間", pose: "クッキーを掲げる" });
    expect(regenerate.items).toHaveLength(8);
    // 未選択の32件は一度も画像APIに渡らない
    const sentMeanings = new Set(api.image.generate.mock.calls.flatMap(([request]) => request.items.map((item: { meaning: string }) => item.meaning)));
    expect([...sentMeanings].sort()).toEqual([...CHOSEN].sort());
  });

  it("選択の変更と画面往復で継続項目の編集・文字設定を保持し、外した項目も再選択で復元する", () => {
    setup(); openSelection(); chooseNonHeadSet(); fireEvent.click(next());
    const second = screen.getByRole("group", { name: "2枚目" });
    fireEvent.change(within(second).getByLabelText("ポーズ"), { target: { value: "布団に入る" } });
    fireEvent.change(within(second).getByLabelText("画像に描く文字"), { target: { value: "" } });
    const eighth = screen.getByRole("group", { name: "8枚目" });
    fireEvent.click(within(eighth).getByLabelText("文字を入れる"));
    fireEvent.change(within(eighth).getByLabelText("追加の指示（任意・500文字以内）"), { target: { value: "クッキーを大きく" } });
    fireEvent.click(screen.getByRole("button", { name: "項目の選択に戻る" }));
    expect(screen.getByText("編集済み（おやすみ）")).toBeInTheDocument();
    // No.40を外してNo.39を選び、もう一度No.40に戻す
    fireEvent.click(checkbox("No.40 おやつの時間"));
    fireEvent.click(checkbox("No.39 また明日"));
    fireEvent.click(checkbox("No.39 また明日"));
    fireEvent.click(checkbox("No.40 おやつの時間"));
    fireEvent.click(screen.getByRole("button", { name: "共通設定に戻る" }));
    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    expect(checkbox("No.12 大丈夫")).toBeChecked();
    fireEvent.click(next());
    const secondAgain = screen.getByRole("group", { name: "2枚目" });
    expect(within(secondAgain).getByLabelText("ポーズ")).toHaveValue("布団に入る");
    expect(within(secondAgain).getByLabelText("画像に描く文字")).toHaveValue("");
    const eighthAgain = screen.getByRole("group", { name: "8枚目" });
    expect(within(eighthAgain).getByLabelText("文字を入れる")).not.toBeChecked();
    expect(within(eighthAgain).getByLabelText("追加の指示（任意・500文字以内）")).toHaveValue("クッキーを大きく");
  });

  it("枚数変更は選択を保持して過不足を示し、40枚は全件選択、テーマ変更は確認する", () => {
    setup();
    fireEvent.change(screen.getByLabelText("共通設定（キャラクターの外見・画風）"), { target: { value: "白いアザラシ" } });
    fireEvent.change(screen.getByLabelText("スタンプ枚数"), { target: { value: "16" } });
    expect(screen.getByText(/現在の選択：8／16件/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    expect(status()).toHaveTextContent("選択中8／16件 あと8件選んでください。");
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "先頭16件に戻す" }));
    fireEvent.click(screen.getByRole("button", { name: "共通設定に戻る" }));
    fireEvent.change(screen.getByLabelText("スタンプ枚数"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    expect(status()).toHaveTextContent("選択中16／8件 8件多く選択しています。8件のチェックを外してください。");
    expect(checkbox("No.16 よろしくね")).toBeChecked();
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "共通設定に戻る" }));
    fireEvent.change(screen.getByLabelText("スタンプ枚数"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    expect(status()).toHaveTextContent("選択中40／40件");
    fireEvent.click(checkbox("No.1 おはよう"));
    expect(status()).toHaveTextContent("選択中39／40件 あと1件選んでください。");
    fireEvent.click(screen.getByRole("button", { name: "共通設定に戻る" }));
    // 初期選択から変更があるため、テーマ変更前に確認する。キャンセルでは何も変えない
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.change(screen.getByLabelText("テーマ"), { target: { value: "work" } });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("テーマ")).toHaveValue("daily");
    expect(screen.getByText(/現在の選択：39／40件/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("スタンプ枚数"), { target: { value: "8" } });
    confirm.mockReturnValueOnce(true);
    fireEvent.change(screen.getByLabelText("テーマ"), { target: { value: "work" } });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("テーマ")).toHaveValue("work");
    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    expect(checkbox("No.1 おはようございます")).toBeChecked();
    expect(status()).toHaveTextContent("選択中8／8件");
  });

  it("生成設定に選択・生成順・個別編集を保存し、読込で先頭N件に置き換えず復元する", async () => {
    const api = setup(); openSelection(); chooseNonHeadSet(); fireEvent.click(next());
    fireEvent.change(within(screen.getByRole("group", { name: "5枚目" })).getByLabelText("ポーズ"), { target: { value: "胸を張る" } });
    fireEvent.click(screen.getByRole("button", { name: "生成設定の保存と読み込み" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "名前を付けて保存" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("生成設定の保存名"), { target: { value: "選択セット" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を付けて保存" }));
    await waitFor(() => expect(api.generationPresets.save).toHaveBeenCalledTimes(1));
    const items = api.generationPresets.save.mock.calls[0][0].snapshot.request.items;
    expect(items.map((item: { sourceTemplateId: string }) => item.sourceTemplateId)).toEqual(["daily-t02", "daily-t04", "daily-t05", "daily-t07", "daily-t12", "daily-t21", "daily-t33", "daily-t40"]);
    expect(items[4]).toMatchObject({ position: 4, pose: "胸を張る" });
    // 別の内容に変えてから読み込む
    fireEvent.click(screen.getByRole("button", { name: "項目の選択に戻る" }));
    fireEvent.click(screen.getByRole("button", { name: "先頭8件に戻す" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "選択セットを読み込み" })).toBeEnabled());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "選択セットを読み込み" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("読み込みました。"));
    fireEvent.click(screen.getByRole("button", { name: "スタンプ内容を作成" }));
    expect(checkbox("No.40 おやつの時間")).toBeChecked();
    expect(checkbox("No.1 おはよう")).not.toBeChecked();
    fireEvent.click(next());
    expect(within(screen.getByRole("group", { name: "5枚目" })).getByLabelText("ポーズ")).toHaveValue("胸を張る");
    expect(api.image.generate).not.toHaveBeenCalled();
  });
});
