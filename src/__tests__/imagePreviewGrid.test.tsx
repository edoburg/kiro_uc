/**
 * ImagePreviewGrid コンポーネントのユニットテスト（Vitest + @testing-library/react）
 *
 * 各ボタンの表示条件・進捗表示・エラー時の再試行ボタン・コールバック発火を確認する。
 * _Requirements: 2.6, 2.8_
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ImagePreviewGrid from "../components/ImagePreviewGrid";
import type { GeneratedImage, GenerationMode } from "../types/index";

/** テスト用の GeneratedImage を生成するヘルパー */
function makeImage(
  index: number,
  status: GeneratedImage["status"],
  overrides: Partial<GeneratedImage> = {}
): GeneratedImage {
  return {
    index,
    dataUrl: `data:image/png;base64,IMG${index}`,
    tempFilePath: `/tmp/img_${index}.png`,
    status,
    ...overrides,
  };
}

/** デフォルト props を組み立てるヘルパー（コールバックはすべて vi.fn()） */
function setup(
  overrides: Partial<React.ComponentProps<typeof ImagePreviewGrid>> = {}
) {
  const props = {
    images: [] as GeneratedImage[],
    mode: "batch" as GenerationMode,
    totalCount: 8,
    onDelete: vi.fn(),
    onRegenerate: vi.fn(),
    onApproveStyle: vi.fn(),
    onRedo: vi.fn(),
    onRetryGeneration: vi.fn(),
    hasError: false,
    ...overrides,
  };
  const utils = render(<ImagePreviewGrid {...props} />);
  return { ...utils, props };
}

describe("ImagePreviewGrid", () => {
  describe("進捗表示（要件 2.5）", () => {
    it("完了枚数 / 全体枚数を progressbar として表示する", () => {
      setup({
        images: [
          makeImage(0, "done"),
          makeImage(1, "done"),
          makeImage(2, "generating"),
        ],
        totalCount: 8,
      });

      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveTextContent("生成済み 2 / 8 枚");
      expect(progressbar).toHaveAttribute("aria-valuenow", "2");
      expect(progressbar).toHaveAttribute("aria-valuemax", "8");
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
    });

    it("完了画像が無いとき完了枚数は 0 になる", () => {
      setup({
        images: [makeImage(0, "pending"), makeImage(1, "generating")],
        totalCount: 8,
      });
      expect(screen.getByRole("progressbar")).toHaveTextContent(
        "生成済み 0 / 8 枚"
      );
    });
  });

  describe("done 画像のボタン表示とコールバック（要件 2.6, 2.9）", () => {
    it("done 画像には削除・再生成ボタンを表示する", () => {
      setup({ images: [makeImage(0, "done")], totalCount: 8 });

      expect(
        screen.getByRole("button", { name: "画像 1 を削除" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "画像 1 を再生成" })
      ).toBeInTheDocument();
    });

    it("削除ボタンで onDelete が該当 index で呼ばれる", () => {
      const { props } = setup({
        images: [makeImage(0, "done"), makeImage(1, "done")],
        totalCount: 8,
      });

      fireEvent.click(screen.getByRole("button", { name: "画像 2 を削除" }));
      expect(props.onDelete).toHaveBeenCalledTimes(1);
      expect(props.onDelete).toHaveBeenCalledWith(1);
    });

    it("再生成ボタンで onRegenerate が該当 index で呼ばれる", () => {
      const { props } = setup({
        images: [makeImage(0, "done")],
        totalCount: 8,
      });

      fireEvent.click(screen.getByRole("button", { name: "画像 1 を再生成" }));
      expect(props.onRegenerate).toHaveBeenCalledTimes(1);
      expect(props.onRegenerate).toHaveBeenCalledWith(0);
    });

    it("pending / generating 画像には削除・再生成ボタンを表示しない", () => {
      setup({
        images: [makeImage(0, "pending"), makeImage(1, "generating")],
        totalCount: 8,
      });

      expect(
        screen.queryByRole("button", { name: /を削除/ })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /を再生成/ })
      ).not.toBeInTheDocument();
    });
  });

  describe("個別画像のエラー状態と再試行ボタン（要件 2.8）", () => {
    it("error 画像には再試行ボタンを表示する", () => {
      setup({
        images: [makeImage(0, "error", { errorMessage: "生成に失敗しました" })],
        totalCount: 8,
      });

      expect(
        screen.getByRole("button", { name: "画像 1 を再試行" })
      ).toBeInTheDocument();
      expect(screen.getByText("生成に失敗しました")).toBeInTheDocument();
    });

    it("再試行ボタンで onRegenerate が該当 index で呼ばれる", () => {
      const { props } = setup({
        images: [makeImage(0, "done"), makeImage(1, "error")],
        totalCount: 8,
      });

      fireEvent.click(screen.getByRole("button", { name: "画像 2 を再試行" }));
      expect(props.onRegenerate).toHaveBeenCalledTimes(1);
      expect(props.onRegenerate).toHaveBeenCalledWith(1);
    });

    it("error 画像には削除ボタンを表示しない", () => {
      setup({ images: [makeImage(0, "error")], totalCount: 8 });
      expect(
        screen.queryByRole("button", { name: /を削除/ })
      ).not.toBeInTheDocument();
    });
  });

  describe("生成全体エラー（hasError）時の表示（要件 2.6）", () => {
    it("hasError のとき「生成をやり直す」ボタンとエラーメッセージを表示する", () => {
      setup({
        hasError: true,
        errorMessage: "画像の生成に失敗しました。",
        images: [makeImage(0, "done")],
        totalCount: 8,
      });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "画像の生成に失敗しました。"
      );
      expect(
        screen.getByRole("button", { name: "生成をやり直す" })
      ).toBeInTheDocument();
      // 全体エラー時は進捗バーやグリッドは描画しない
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("「生成をやり直す」ボタンで onRetryGeneration が呼ばれる", () => {
      const { props } = setup({ hasError: true, totalCount: 8 });

      fireEvent.click(
        screen.getByRole("button", { name: "生成をやり直す" })
      );
      expect(props.onRetryGeneration).toHaveBeenCalledTimes(1);
    });

    it("onRetryGeneration 未指定なら再実行ボタンを表示しない", () => {
      render(
        <ImagePreviewGrid
          images={[]}
          mode="batch"
          totalCount={8}
          onDelete={vi.fn()}
          onRegenerate={vi.fn()}
          hasError
        />
      );
      expect(
        screen.queryByRole("button", { name: "生成をやり直す" })
      ).not.toBeInTheDocument();
    });

    it("errorMessage 未指定ならデフォルトの日本語メッセージを表示する", () => {
      setup({ hasError: true, totalCount: 8 });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "画像の生成に失敗しました。もう一度お試しください。"
      );
    });
  });

  describe("プレビュー承認モードのボタン表示条件（要件 2.2, 2.3, 2.4）", () => {
    it("preview_approval モードで 1 枚完了 & totalCount > 1 のとき承認ボタンを表示する", () => {
      setup({
        mode: "preview_approval",
        images: [makeImage(0, "done")],
        totalCount: 8,
      });

      expect(
        screen.getByRole("button", { name: "このスタイルで残りを生成する" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "やり直す" })
      ).toBeInTheDocument();
    });

    it("batch モードでは承認ボタンを表示しない", () => {
      setup({
        mode: "batch",
        images: [makeImage(0, "done")],
        totalCount: 8,
      });

      expect(
        screen.queryByRole("button", {
          name: "このスタイルで残りを生成する",
        })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "やり直す" })
      ).not.toBeInTheDocument();
    });

    it("完了枚数が 0 のときは承認ボタンを表示しない", () => {
      setup({
        mode: "preview_approval",
        images: [makeImage(0, "generating")],
        totalCount: 8,
      });
      expect(
        screen.queryByRole("button", {
          name: "このスタイルで残りを生成する",
        })
      ).not.toBeInTheDocument();
    });

    it("totalCount が 1 のときは承認ボタンを表示しない", () => {
      setup({
        mode: "preview_approval",
        images: [makeImage(0, "done")],
        totalCount: 1,
      });
      expect(
        screen.queryByRole("button", {
          name: "このスタイルで残りを生成する",
        })
      ).not.toBeInTheDocument();
    });
  });

  describe("プレビュー承認モードのコールバック（要件 2.3, 2.4）", () => {
    it("「このスタイルで残りを生成する」で onApproveStyle が n-1 で呼ばれる", () => {
      const { props } = setup({
        mode: "preview_approval",
        images: [makeImage(0, "done")],
        totalCount: 8,
      });

      fireEvent.click(
        screen.getByRole("button", { name: "このスタイルで残りを生成する" })
      );
      expect(props.onApproveStyle).toHaveBeenCalledTimes(1);
      expect(props.onApproveStyle).toHaveBeenCalledWith(7);
    });

    it("「やり直す」で onRedo が呼ばれる", () => {
      const { props } = setup({
        mode: "preview_approval",
        images: [makeImage(0, "done")],
        totalCount: 8,
      });

      fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
      expect(props.onRedo).toHaveBeenCalledTimes(1);
    });

    it("生成中は承認操作と個別操作を無効化する", () => {
      setup({
        mode: "preview_approval",
        images: [makeImage(0, "done")],
        totalCount: 8,
        isGenerating: true,
      });

      expect(
        screen.queryByRole("button", {
          name: "このスタイルで残りを生成する",
        }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "画像 1 を削除" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "画像 1 を再生成" })).toBeDisabled();
    });
  });

  describe("グリッド描画", () => {
    it("画像一覧のリストをレンダリングする", () => {
      setup({
        images: [makeImage(0, "done"), makeImage(1, "done")],
        totalCount: 8,
      });

      const list = screen.getByRole("list", { name: "生成画像一覧" });
      const items = within(list).getAllByRole("listitem");
      expect(items).toHaveLength(2);
    });
  });
});
