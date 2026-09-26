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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** テスト用の適合済み StampImage を 1 件生成する */
function makeImage(index: number): StampImage {
  return {
    stampPath: `stamp-${index}.png`,
    mainImagePath: `main-${index}.png`,
    thumbnailPath: `thumb-${index}.png`,
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
    images: [makeImage(0), makeImage(1)],
    isValidForUpload: true,
    ...overrides,
  };
}

/** コールバックを vi.fn() で用意しつつ StampSetEditor をレンダリングする */
function renderEditor(stampSet: StampSet) {
  const handlers = {
    onTitleChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onReplaceImage: vi.fn(),
    onExport: vi.fn(),
    onUpload: vi.fn(),
  } satisfies Omit<StampSetEditorProps, "stampSet">;

  render(<StampSetEditor stampSet={stampSet} {...handlers} />);
  return handlers;
}

describe("StampSetEditor - タイトルバリデーション表示（要件 4.2）", () => {
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

  it("LINE規格未通過のときアップロードボタンは無効（要件 5.6）", () => {
    renderEditor(makeStampSet({ isValidForUpload: false }));
    expect(
      screen.getByRole("button", {
        name: "LINE Creators Market へアップロード",
      }),
    ).toBeDisabled();
  });

  it("エクスポート時に window.prompt のパスで onExport が呼ばれる（要件 4.7, 4.8）", () => {
    vi.spyOn(window, "prompt").mockReturnValue("/tmp/out");
    const handlers = renderEditor(makeStampSet({ title: "有効なタイトル" }));
    fireEvent.click(
      screen.getByRole("button", { name: "エクスポート（ZIP保存）" }),
    );
    expect(handlers.onExport).toHaveBeenCalledWith("/tmp/out");
  });

  it("エクスポート先が未入力（prompt キャンセル）の場合 onExport は呼ばれない", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const handlers = renderEditor(makeStampSet({ title: "有効なタイトル" }));
    fireEvent.click(
      screen.getByRole("button", { name: "エクスポート（ZIP保存）" }),
    );
    expect(handlers.onExport).not.toHaveBeenCalled();
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
    expect(handlers.onReplaceImage).toHaveBeenCalledWith(0, pngFile);
  });
});
