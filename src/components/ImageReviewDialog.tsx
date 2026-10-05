import { useEffect, useRef, useState } from "react";
import type { GeneratedImage, StampPlanItem } from "../types";
import { resolveDisplayText } from "../utils/stampPlan";
import PreviewImage from "./PreviewImage";
import PreviewBackgroundControls from "./PreviewBackgroundControls";
import RegenerationEditor from "./RegenerationEditor";

interface Props {
  image: GeneratedImage;
  item?: StampPlanItem;
  items?: StampPlanItem[];
  isGenerating: boolean;
  canGenerate: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onClose: () => void;
  onNavigate: (direction: number) => void;
  onRegenerate: () => void;
  onConfirm?: (item: StampPlanItem) => void;
}

export default function ImageReviewDialog({ image, item, items, isGenerating, canGenerate, hasPrevious, hasNext, onClose, onNavigate, onRegenerate, onConfirm }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [editorVersion, setEditorVersion] = useState(0);
  const discard = () => !dirty.current || window.confirm("未確定の編集を破棄しますか？");
  const close = () => { if (discard()) onClose(); };
  const navigate = (direction: number) => { if (discard()) onNavigate(direction); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter((node) => !node.contains(dialog.current));
    const inertValues = siblings.map((node) => node.getAttribute("inert"));
    siblings.forEach((node) => node.setAttribute("inert", ""));
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      siblings.forEach((node, index) => { const value = inertValues[index]; if (value === null) node.removeAttribute("inert"); else node.setAttribute("inert", value); });
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const source = image.generationItem;
  return <div className="image-review-backdrop">
    <div className="image-review-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label={`画像 ${image.index + 1} の詳細レビュー`} tabIndex={-1} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const nodes = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="image-review-toolbar">
        <h2>項目 {image.index + 1}：{item?.meaning ?? "画像レビュー"}</h2>
        <button type="button" onClick={close}>閉じる</button>
        <button type="button" disabled={!hasPrevious} onClick={() => navigate(-1)}>前の画像</button>
        <button type="button" disabled={!hasNext} onClick={() => navigate(1)}>次の画像</button>
        <button type="button" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>縮小</button>
        <output aria-label="表示倍率">{Math.round(zoom * 100)}%</output>
        <button type="button" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.25))}>拡大</button>
        <button type="button" onClick={() => setZoom(1)}>表示領域に収める</button>
      </div>
      <PreviewBackgroundControls />
      <p role="status">{isGenerating ? "生成中（元画像を表示しています）" : { pending: "未生成・承認待ち", generating: "生成中", done: "生成済み", error: "生成失敗" }[image.status]}</p>
      <div className="image-review-viewport" tabIndex={0} aria-label="画像表示領域（拡大時はスクロールできます）">
        <div className="image-review-size" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          {image.dataUrl ? <PreviewImage className="image-review-image" src={image.dataUrl} alt={`生成されたスタンプ画像 ${image.index + 1}`} /> : <p>この項目の画像はまだありません。</p>}
        </div>
      </div>
      {image.dataUrl && <div className="image-review-source">
        <p>表示画像に使った文字：{image.textSettings?.textEnabled ? image.textSettings.displayText : "文字なし"}</p>
        {source ? <p>表示画像の生成条件：{source.meaning} ／ {source.expression} ／ {source.pose} ／ {source.prop || "小物なし"} ／ {source.additionalInstructions || "追加指示なし"}</p> : <p>表示画像の生成条件の記録はありません。</p>}
      </div>}
      {image.errorMessage && <p role="alert">{image.errorMessage}</p>}
      {item && <p>次回の再生成条件：{item.meaning} ／ {item.pose} ／ {item.textEnabled ? resolveDisplayText(item) : "文字なし"}（表示画像の条件とは別です）</p>}
      {canGenerate && item && items && onConfirm && !isGenerating ? <RegenerationEditor key={`${item.id}-${editorVersion}`} item={item} items={items} onDirtyChange={(value) => { dirty.current = value; }} handleEscape={false} autoFocus={false}
        onCancel={() => { if (discard()) { dirty.current = false; setEditorVersion((value) => value + 1); } }}
        onConfirm={(edited) => { dirty.current = false; onConfirm(edited); }} />
        : canGenerate ? <button type="button" disabled={isGenerating} onClick={onRegenerate}>この画像を再試行</button>
        : <p>先頭プレビューを承認してから、この項目を生成できます。</p>}
    </div>
  </div>;
}
