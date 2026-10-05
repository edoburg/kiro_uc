import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ImagePreviewGrid from "../components/ImagePreviewGrid";
import PreviewImage from "../components/PreviewImage";
import PreviewBackgroundControls from "../components/PreviewBackgroundControls";
import { usePreviewBackground } from "../stores/previewBackgroundStore";
import { createStampPlan } from "../utils/stampPlan";
import type { GeneratedImage } from "../types";

beforeEach(() => usePreviewBackground.setState({ background: "checker", customColor: "#80c0ff" }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const items = createStampPlan("daily", 8);
const images: GeneratedImage[] = [0, 3].map((index) => ({ index, itemId: items[index].id, status: "done", dataUrl: `data:image/png;base64,${index}`, tempFilePath: `${index}.png`, generationItem: { ...items[index] }, textSettings: { textEnabled: true, displayText: items[index].meaning } }));

function setup(overrides: Partial<React.ComponentProps<typeof ImagePreviewGrid>> = {}) {
  const props = { images, items, totalCount: 8, mode: "batch" as const, onDelete: vi.fn(), onRegenerate: vi.fn(), onRegenerateWithEdits: vi.fn(), ...overrides };
  const view = render(<ImagePreviewGrid {...props} />);
  return { ...view, props };
}
function open(index = 3) {
  const button = screen.getByRole("button", { name: `画像 ${index + 1} を大きく表示` });
  button.focus(); fireEvent.click(button);
  return { button, dialog: screen.getByRole("dialog") };
}

describe("透過確認と詳細レビュー", () => {
  it("CSS背景だけを共有して変更し、画像URLと確定条件を保持する", () => {
    const { props } = setup(); const snapshot = JSON.stringify(props);
    const { dialog } = open();
    fireEvent.change(within(dialog).getByLabelText("表示背景"), { target: { value: "black" } });
    screen.getAllByAltText("生成されたスタンプ画像 4").forEach((img) => {
      expect(img).toHaveAttribute("src", images[1].dataUrl);
      expect(img.parentElement).toHaveStyle({ backgroundColor: "#000000" });
      expect(img.parentElement).not.toHaveClass("preview-surface--checker");
    });
    fireEvent.change(within(dialog).getByLabelText("表示背景"), { target: { value: "custom" } });
    fireEvent.change(within(dialog).getByLabelText("任意の背景色"), { target: { value: "#ff8800" } });
    expect(usePreviewBackground.getState().customColor).toBe("#ff8800");
    expect(JSON.stringify(props)).toBe(snapshot);
    expect(props.onRegenerateWithEdits).not.toHaveBeenCalled();
    expect(props.onRegenerate).not.toHaveBeenCalled();
  });

  it("ズーム・収める・前後移動・Escape・フォーカス復帰を提供する", () => {
    setup(); const { button, dialog } = open();
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "閉じる" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(within(dialog).getByRole("button", { name: "この内容で再生成" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "拡大" }));
    expect(within(dialog).getByLabelText("表示倍率")).toHaveTextContent("125%");
    fireEvent.click(within(dialog).getByRole("button", { name: "表示領域に収める" }));
    expect(within(dialog).getByLabelText("表示倍率")).toHaveTextContent("100%");
    fireEvent.click(within(dialog).getByRole("button", { name: "次の画像" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("画像 5 の詳細レビュー");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "前の画像" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("編集破棄をキャンセルすると入力と画像を保持し、確定は対象IDだけに渡す", () => {
    const { props } = setup(); const { dialog } = open();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.change(within(dialog).getByLabelText("ポーズ"), { target: { value: "仰向けで眠る" } });
    fireEvent.change(within(dialog).getByLabelText("画像に描く文字"), { target: { value: "ぐっすり！" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "次の画像" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByLabelText("ポーズ")).toHaveValue("仰向けで眠る");
    expect(items[3].pose).toBe("丸くなって枕に頭をのせる");
    fireEvent.click(within(dialog).getByRole("button", { name: "この内容で再生成" }));
    expect(props.onRegenerateWithEdits).toHaveBeenCalledTimes(1);
    expect(props.onRegenerateWithEdits).toHaveBeenCalledWith(3, expect.objectContaining({ id: items[3].id, pose: "仰向けで眠る", displayText: "ぐっすり！" }));
  });

  it("キャンセルでドラフトを戻し、未確定編集を破棄して閉じられる", () => {
    const { props } = setup(); const { dialog } = open();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.change(within(dialog).getByLabelText("ポーズ"), { target: { value: "変更" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(within(dialog).getByLabelText("ポーズ")).toHaveValue(items[3].pose);
    fireEvent.change(within(dialog).getByLabelText("ポーズ"), { target: { value: "変更" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.onRegenerateWithEdits).not.toHaveBeenCalled();
  });

  it("一覧の順序が変わってもIDを維持し、対象項目の削除で閉じる", () => {
    const { props, rerender } = setup(); open();
    rerender(<ImagePreviewGrid {...props} items={[items[3], ...items.filter((item) => item.id !== items[3].id)]} images={[...images].reverse()} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("画像 4 の詳細レビュー");
    rerender(<ImagePreviewGrid {...props} items={items.filter((item) => item.id !== items[3].id)} images={[images[0]]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("生成中も旧成功画像を表示し、再送信を禁止する", () => {
    const { props, rerender } = setup(); const { dialog } = open();
    rerender(<ImagePreviewGrid {...props} isGenerating />);
    expect(within(dialog).getByText("生成中（元画像を表示しています）")).toBeInTheDocument();
    expect(within(dialog).getByAltText("生成されたスタンプ画像 4")).toHaveAttribute("src", images[1].dataUrl);
    expect(within(dialog).queryByRole("button", { name: "この内容で再生成" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "この画像を再試行" })).toBeDisabled();
  });

  it("未承認の後続項目は再生成を提供せず、画像削除後は未生成表示になる", () => {
    const { props, rerender } = setup({ mode: "preview_approval", images: [images[0]] }); open(3);
    expect(screen.getByRole("dialog")).toHaveTextContent("先頭プレビューを承認してから");
    expect(within(screen.getByRole("dialog")).queryByRole("form")).not.toBeInTheDocument();
    rerender(<ImagePreviewGrid {...props} mode="batch" images={images} />);
    rerender(<ImagePreviewGrid {...props} mode="batch" images={[images[0]]} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("この項目の画像はまだありません");
  });

  it("変換後と同じ表示部品でも画像を加工せず、任意色を適用する", () => {
    render(<><PreviewBackgroundControls /><PreviewImage src="converted.png" alt="変換後スタンプ" /><PreviewImage src="main.png" alt="メイン" /><PreviewImage src="tab.png" alt="タブ" /></>);
    fireEvent.change(screen.getByLabelText("表示背景"), { target: { value: "gray" } });
    ["converted.png", "main.png", "tab.png"].forEach((url) => expect(document.querySelector(`img[src="${url}"]`)?.parentElement).toHaveStyle({ backgroundColor: "#eeeeee" }));
  });
});
