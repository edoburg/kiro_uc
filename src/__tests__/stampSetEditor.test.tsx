/**
 * StampSetEditor のユニットテスト（Vitest + @testing-library/react）
 *
 * 検証対象:
 * - タイトル（1〜40文字）／説明（0〜160文字）のバリデーションエラー表示（要件 4.2, 4.3）
 * - エクスポートボタンの活性／非活性制御（タイトル検証結果に依存、要件 4.7）
 * - PNG 以外の差し替えエラー表示（要件 4.4, 4.5）
 * - 各コールバック（onTitleChange, onDescriptionChange, onExport, onUpload, onReplaceImage）の発火
 *
 * ユーザー向けテキストはすべて日本語（product.md）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import StampSetEditor, {
  type StampSetEditorProps,
} from "../components/StampSetEditor";
import type { StampImage, StampSet } from "../types/index";
import { usePreviewBackground } from "../stores/previewBackgroundStore";

afterEach(() => {
  cleanup();
  usePreviewBackground.setState({ background: "checker" });
  vi.restoreAllMocks();
});

/** テスト用の適合済み StampImage を 1 件生成する */
function makeImage(index: number): StampImage {
  return {
    id: `item-${index}`,
    sourcePath: `source-${index}.png`,
    stampPath: `stamp-${index}.png`,
    mainImagePath: `main-${index}.png`,
    thumbnailPath: `thumb-${index}.png`,
    stampPreviewUrl: `data:image/png;base64,stamp-${index}`,
    mainImagePreviewUrl: `data:image/png;base64,main-${index}`,
    thumbnailPreviewUrl: `data:image/png;base64,thumb-${index}`,
    processingStatus: "done",
    validationResult: {
      passed: true,
      sizeOk: true,
      formatOk: true,
      fileSizeOk: true,
      fileSizeExceeded: false,
      details: "OK",
    },
  };
}

/** テスト用の StampSet を生成する（引数で上書き可能） */
function makeStampSet(overrides: Partial<StampSet> = {}): StampSet {
  return {
    title: "サンプルスタンプ",
    description: "説明文",
    creatorName: "サンプル作者",
    copyright: "© Sample Creator",
    images: Array.from({ length: 8 }, (_, index) => makeImage(index)),
    mainImageId: "item-0",
    tabImageId: "item-0",
    isValidForUpload: true,
    ...overrides,
  };
}

/** コールバックを vi.fn() で用意しつつ StampSetEditor をレンダリングする */
function renderEditor(
  stampSet: StampSet,
  overrides: Partial<Omit<StampSetEditorProps, "stampSet">> = {},
) {
  const handlers = {
    onTitleChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onCreatorNameChange: vi.fn(),
    onCopyrightChange: vi.fn(),
    onReplaceImage: vi.fn(),
    onRetryImage: vi.fn(),
    onSelectRepresentative: vi.fn(),
    onDeleteImage: vi.fn(),
    onExport: vi.fn(),
    isExporting: false,
    exportMessage: null,
    onUpload: vi.fn(),
  } satisfies Omit<StampSetEditorProps, "stampSet">;

  render(<StampSetEditor stampSet={stampSet} {...handlers} {...overrides} />);
  return handlers;
}

describe("StampSetEditor - タイトルバリデーション表示（要件 4.2）", () => {
  it("変換後の3種の画像はCSS背景だけを共有し、元の出力パスとURLでエクスポートする", () => {
    const stampSet = makeStampSet();
    const original = JSON.stringify(stampSet);
    const handlers = renderEditor(stampSet);
    fireEvent.change(screen.getByLabelText("表示背景"), { target: { value: "black" } });
    for (const name of ["スタンプ画像 1", "メイン画像 1", "サムネイル画像 1"]) {
      expect(screen.getByAltText(name).parentElement).toHaveStyle({ backgroundColor: "#000000" });
    }
    expect(screen.getByAltText("スタンプ画像 1")).toHaveAttribute("src", stampSet.images[0].stampPreviewUrl);
    expect(handlers.onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "エクスポート（ZIP保存）" }));
    expect(handlers.onExport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(stampSet)).toBe(original);
    expect(handlers.onReplaceImage).not.toHaveBeenCalled();
  });
  it("空タイトルはエラーメッセージを表示する", () => {
    renderEditor(makeStampSet({ title: "" }));
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((el) => el.textContent === "タイトルを入力してください"),
    ).toBe(true);
  });

  it("40文字超のタイトルはエラーメッセージを表示する", () => {
    const longTitle = "あ".repeat(41);
    renderEditor(makeStampSet({ title: longTitle }));
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((el) =>
        el.textContent?.includes("タイトルは40文字以内で入力してください"),
      ),
    ).toBe(true);
  });

  it("有効なタイトル（1〜40文字）ではタイトルエラーを表示しない", () => {
    renderEditor(makeStampSet({ title: "OKなタイトル" }));
    expect(
      screen.queryByText("タイトルを入力してください"),
    ).not.toBeInTheDocument();
  });
});

describe("StampSetEditor - 説明バリデーション表示（要件 4.3）", () => {
  it("160文字超の説明はエラーメッセージを表示する", () => {
    const longDesc = "説".repeat(161);
    renderEditor(makeStampSet({ description: longDesc }));
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((el) =>
        el.textContent?.includes("説明は160文字以内で入力してください"),
      ),
    ).toBe(true);
  });

  it("160文字以内の説明では説明エラーを表示しない", () => {
    renderEditor(makeStampSet({ description: "適切な説明" }));
    expect(
      screen.queryByText(/説明は160文字以内で入力してください/),
    ).not.toBeInTheDocument();
  });

  it("空の説明（0文字）は許可されエラーを表示しない", () => {
    renderEditor(makeStampSet({ description: "" }));
    expect(
      screen.queryByText(/説明は160文字以内/),
    ).not.toBeInTheDocument();
  });
});

describe("StampSetEditor - エクスポートボタンの活性制御（要件 4.7）", () => {
  const getExportButton = () =>
    screen.getByRole("button", { name: "エクスポート（ZIP保存）" });

  it("タイトルが有効なときエクスポートボタンは有効", () => {
    renderEditor(makeStampSet({ title: "有効なタイトル" }));
    expect(getExportButton()).toBeEnabled();
  });

  it("タイトルが空のときエクスポートボタンは無効", () => {
    renderEditor(makeStampSet({ title: "" }));
    expect(getExportButton()).toBeDisabled();
  });

  it("タイトルが40文字超のときエクスポートボタンは無効", () => {
    renderEditor(makeStampSet({ title: "あ".repeat(41) }));
    expect(getExportButton()).toBeDisabled();
  });
});

describe("StampSetEditor - コールバック発火", () => {
  it("タイトル入力で onTitleChange が呼ばれる（要件 4.2）", () => {
    const handlers = renderEditor(makeStampSet());
    const input = screen.getByLabelText("タイトル（1〜40文字）");
    fireEvent.change(input, { target: { value: "新タイトル" } });
    expect(handlers.onTitleChange).toHaveBeenCalledWith("新タイトル");
  });

  it("説明入力で onDescriptionChange が呼ばれる（要件 4.3）", () => {
    const handlers = renderEditor(makeStampSet());
    const textarea = screen.getByLabelText("説明（0〜160文字・任意）");
    fireEvent.change(textarea, { target: { value: "新しい説明" } });
    expect(handlers.onDescriptionChange).toHaveBeenCalledWith("新しい説明");
  });

  it("アップロードボタン押下で onUpload が呼ばれる（要件 5.6）", () => {
    const handlers = renderEditor(makeStampSet({ isValidForUpload: true }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "LINE Creators Market へアップロード",
      }),
    );
    expect(handlers.onUpload).toHaveBeenCalledTimes(1);
  });

  it("LINEアップロード保留中は関連項目とアップロード導線を表示しない", () => {
    renderEditor(
      makeStampSet({ creatorName: "", copyright: "" }),
      { lineUploadEnabled: false },
    );

    expect(screen.queryByLabelText(/クリエイター名/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/コピーライト/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "LINE Creators Market へアップロード",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("クリエイター名を入力してください"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "エクスポート（ZIP保存）" })).toBeEnabled();
  });

  it("LINE規格未通過のときアップロードボタンは無効（要件 5.6）", () => {
    const invalidImage = {
      ...makeImage(0),
      validationResult: {
        ...makeImage(0).validationResult,
        passed: false,
        sizeOk: false,
        details: "画像サイズが規格外です",
      },
    };
    renderEditor(
      makeStampSet({
        images: [
          invalidImage,
          ...Array.from({ length: 7 }, (_, index) => makeImage(index + 1)),
        ],
        isValidForUpload: false,
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "LINE Creators Market へアップロード",
      }),
    ).toBeDisabled();
  });

  it("エクスポート時に onExport が呼ばれる（要件 4.7, 4.8）", () => {
    const handlers = renderEditor(makeStampSet({ title: "有効なタイトル" }));
    fireEvent.click(
      screen.getByRole("button", { name: "エクスポート（ZIP保存）" }),
    );
    expect(handlers.onExport).toHaveBeenCalledTimes(1);
  });

  it("ZIP作成中はボタンを無効化する", () => {
    const stampSet = makeStampSet({ title: "有効なタイトル" });
    const handlers = {
      onTitleChange: vi.fn(),
      onDescriptionChange: vi.fn(),
      onCreatorNameChange: vi.fn(),
      onCopyrightChange: vi.fn(),
      onReplaceImage: vi.fn(),
      onRetryImage: vi.fn(),
      onSelectRepresentative: vi.fn(),
      onDeleteImage: vi.fn(),
      onExport: vi.fn(),
      isExporting: true,
      exportMessage: null,
      onUpload: vi.fn(),
    } satisfies Omit<StampSetEditorProps, "stampSet">;
    render(<StampSetEditor stampSet={stampSet} {...handlers} />);

    expect(
      screen.getByRole("button", { name: "ZIPを作成中…" }),
    ).toBeDisabled();
  });

  it("ZIP保存完了メッセージを表示する", () => {
    const stampSet = makeStampSet();
    const handlers = {
      onTitleChange: vi.fn(),
      onDescriptionChange: vi.fn(),
      onCreatorNameChange: vi.fn(),
      onCopyrightChange: vi.fn(),
      onReplaceImage: vi.fn(),
      onRetryImage: vi.fn(),
      onSelectRepresentative: vi.fn(),
      onDeleteImage: vi.fn(),
      onExport: vi.fn(),
      isExporting: false,
      exportMessage: "サンプル.zip を保存しました。",
      onUpload: vi.fn(),
    } satisfies Omit<StampSetEditorProps, "stampSet">;
    render(<StampSetEditor stampSet={stampSet} {...handlers} />);

    expect(
      screen.getByText("サンプル.zip を保存しました。"),
    ).toHaveAttribute("role", "status");
  });
});

describe("StampSetEditor - 画像差し替え（要件 4.4, 4.5, 4.6）", () => {
  it("PNG 以外を選択するとエラーメッセージを表示し onReplaceImage は呼ばれない", () => {
    const handlers = renderEditor(makeStampSet());
    const item = screen
      .getByRole("button", { name: "スタンプ画像 1 を差し替え" })
      .closest("li") as HTMLElement;
    const input = item.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const jpgFile = new File(["dummy"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [jpgFile] } });

    expect(
      within(item).getByText("PNG形式のファイルを選択してください"),
    ).toBeInTheDocument();
    expect(handlers.onReplaceImage).not.toHaveBeenCalled();
  });

  it("PNG を選択すると onReplaceImage が該当インデックスとファイルで呼ばれる", () => {
    const handlers = renderEditor(makeStampSet());
    const item = screen
      .getByRole("button", { name: "スタンプ画像 1 を差し替え" })
      .closest("li") as HTMLElement;
    const input = item.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const pngFile = new File(["dummy"], "new.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [pngFile] } });

    expect(handlers.onReplaceImage).toHaveBeenCalledTimes(1);
    expect(handlers.onReplaceImage).toHaveBeenCalledWith("item-0", pngFile);
  });

  it("変換失敗画像では再試行ボタンを表示してコールバックを呼ぶ", () => {
    const failed = {
      ...makeImage(0),
      processingStatus: "error" as const,
      processingError: "変換に失敗しました。",
      validationResult: {
        ...makeImage(0).validationResult,
        passed: false,
        details: "変換に失敗しました。",
      },
    };
    const set = makeStampSet();
    set.images[0] = failed;
    const handlers = renderEditor(set);

    fireEvent.click(screen.getByRole("button", { name: "変換を再試行" }));
    expect(handlers.onRetryImage).toHaveBeenCalledWith("item-0");
    expect(screen.getByText(/変換失敗/)).toBeInTheDocument();
  });

  it("規定外の画像枚数ではアップロード不可だがエクスポートは可能", () => {
    renderEditor(makeStampSet({ images: [makeImage(0)] }));

    expect(
      screen.getByRole("button", { name: "LINE Creators Market へアップロード" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "エクスポート（ZIP保存）" }),
    ).toBeEnabled();
    expect(screen.getByText(/スタンプ画像の枚数/)).toBeInTheDocument();
  });
});

describe("StampSetEditor - メイン画像・タブ画像の選択", () => {
  it("選択中の派生画像（元画像ではない）を上部に表示し、各画像に選択状態を示す", () => {
    renderEditor(makeStampSet({ mainImageId: "item-2", tabImageId: "item-4" }));

    const summary = screen.getByRole("region", { name: "メイン画像とトークルームタブ画像" });
    expect(
      within(summary).getByAltText("選択中のメイン画像（スタンプ 3）"),
    ).toHaveAttribute("src", "data:image/png;base64,main-2");
    expect(
      within(summary).getByAltText("選択中のトークルームタブ画像（スタンプ 5）"),
    ).toHaveAttribute("src", "data:image/png;base64,thumb-4");
    expect(summary).toHaveTextContent("スタンプ 3 から作成");
    expect(summary).toHaveTextContent("中央を正方形に切り抜く");

    expect(
      screen.getByRole("button", { name: "スタンプ 3 をメイン画像に使う" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "スタンプ 5 をタブ画像に使う" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "スタンプ 1 をメイン画像に使う" }),
    ).toHaveAttribute("aria-pressed", "false");
    const third = screen.getByRole("heading", { name: "スタンプ 3" }).closest("li") as HTMLElement;
    expect(within(third).getByText("メイン画像に選択中", { selector: "span" })).toBeInTheDocument();
  });

  it("選択ボタンは画像IDで通知し、メインとタブを独立して選べる", () => {
    const handlers = renderEditor(makeStampSet());

    fireEvent.click(screen.getByRole("button", { name: "スタンプ 3 をメイン画像に使う" }));
    fireEvent.click(screen.getByRole("button", { name: "スタンプ 5 をタブ画像に使う" }));

    expect(handlers.onSelectRepresentative).toHaveBeenNthCalledWith(1, "main", "item-2");
    expect(handlers.onSelectRepresentative).toHaveBeenNthCalledWith(2, "tab", "item-4");
    expect(handlers.onReplaceImage).not.toHaveBeenCalled();
    expect(handlers.onRetryImage).not.toHaveBeenCalled();
  });

  it("変換失敗・変換中の画像は選択できない", () => {
    const set = makeStampSet();
    set.images[1] = {
      ...makeImage(1),
      processingStatus: "error",
      mainImagePath: "",
      thumbnailPath: "",
      mainImagePreviewUrl: "",
      thumbnailPreviewUrl: "",
    };
    set.images[2] = { ...makeImage(2), processingStatus: "processing" };
    renderEditor(set);

    for (const position of [2, 3]) {
      expect(
        screen.getByRole("button", { name: `スタンプ ${position} をメイン画像に使う` }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: `スタンプ ${position} をタブ画像に使う` }),
      ).toBeDisabled();
    }
    expect(screen.getAllByText("未作成")).toHaveLength(2);
  });

  it("未選択または不正なIDでは理由を表示し、ZIP保存とアップロードを無効化する", () => {
    renderEditor(makeStampSet({ mainImageId: null, tabImageId: "missing", isValidForUpload: false }));

    const summary = screen.getByRole("region", { name: "メイン画像とトークルームタブ画像" });
    expect(summary).toHaveTextContent("メイン画像が選択されていません");
    expect(summary).toHaveTextContent("選択中のタブ画像がスタンプセット内に見つかりません");
    expect(screen.getByRole("button", { name: "エクスポート（ZIP保存）" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "LINE Creators Market へアップロード" }),
    ).toBeDisabled();
  });

  it("選択中の画像を削除するときは選択解除を知らせて確認する", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const handlers = renderEditor(makeStampSet({ mainImageId: "item-2", tabImageId: "item-2" }));

    fireEvent.click(screen.getByRole("button", { name: "スタンプ画像 3 を削除" }));
    expect(confirm.mock.calls[0][0]).toContain("メイン画像とタブ画像に選択されています");
    expect(confirm.mock.calls[0][0]).toContain("未選択");
    expect(handlers.onDeleteImage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "スタンプ画像 3 を削除" }));
    expect(handlers.onDeleteImage).toHaveBeenCalledWith("item-2");
  });

  it("選択していない画像の削除確認には選択解除の説明を含めない", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const handlers = renderEditor(makeStampSet());

    fireEvent.click(screen.getByRole("button", { name: "スタンプ画像 4 を削除" }));

    expect(confirm.mock.calls[0][0]).toBe("スタンプ 4 をセットから削除しますか？");
    expect(handlers.onDeleteImage).toHaveBeenCalledWith("item-3");
  });
});
