import React from "react";
import type { GeneratedImage, GenerationMode, StampPlanItem } from "../types/index";
import RegenerationEditor from "./RegenerationEditor";
import { createPortal } from "react-dom";
import PreviewImage from "./PreviewImage";
import PreviewBackgroundControls from "./PreviewBackgroundControls";
import ImageReviewDialog from "./ImageReviewDialog";

/**
 * ImagePreviewGrid の Props。
 *
 * 設計 (design.md) の基本契約（images / onDelete / onRegenerate）に加え、
 * 要件 2.2〜2.6, 2.9 を満たすためのプレビュー承認モード用コールバックと
 * 進捗表示・生成失敗時の再実行コールバックを公開する。
 */
export interface ImagePreviewGridProps {
  /** 表示対象の生成画像一覧 */
  images: GeneratedImage[];
  items?: StampPlanItem[];
  /** 生成モード（"batch" | "preview_approval"） */
  mode: GenerationMode;
  /** 生成予定の総枚数（進捗表示・残り枚数算出に使用） */
  totalCount: number;
  /** 個別画像の削除（要件 2.9） */
  onDelete: (index: number) => void;
  /** 保存済みの個別条件を使う再試行。 */
  onRegenerate: (index: number) => void;
  /** 成功画像の編集済み条件を確定して単独再生成する。 */
  onRegenerateWithEdits?: (index: number, item: StampPlanItem) => void;
  /**
   * プレビュー承認モードで「このスタイルで残りを生成する」を押したときのコールバック。
   * 引数 remainingCount は残り生成枚数（= totalCount - 1、要件 2.3）。
   */
  onApproveStyle?: (remainingCount: number) => void;
  /** プレビュー承認モードで「やり直す」を押したとき（生成済み 1 枚を破棄、要件 2.4） */
  onRedo?: () => void;
  /**
   * プレビュー表示失敗などにより生成全体が失敗した場合の再実行（要件 2.6）。
   * 指定され、かつ hasError が true のときにのみ再実行ボタンを表示する。
   */
  onRetryGeneration?: () => void;
  /** 生成プロセス全体が失敗したか（要件 2.6） */
  hasError?: boolean;
  /** 生成失敗時に表示するエラーメッセージ（日本語） */
  errorMessage?: string;
  /** 生成要求が実行中か。多重開始を防ぐため操作を無効化する。 */
  isGenerating?: boolean;
  approvalGranted?: boolean;
}

/**
 * プレビュー承認モードで「残りを生成する」際の残り枚数を算出する（要件 2.3）。
 * 総枚数 n に対して常に n - 1 を返す（負値は 0 に丸める）。
 */
export function remainingCountForApproval(totalCount: number): number {
  return Math.max(0, totalCount - 1);
}

/**
 * 生成された画像をグリッド表示し、個別操作（削除・再生成）と
 * 生成進捗のリアルタイム表示、プレビュー承認モードの操作を提供するコンポーネント。
 *
 * 要件: 2.2, 2.3, 2.4, 2.5, 2.6, 2.9
 */
const ImagePreviewGrid: React.FC<ImagePreviewGridProps> = ({
  images,
  items,
  mode,
  totalCount,
  onDelete,
  onRegenerate,
  onRegenerateWithEdits,
  onApproveStyle,
  onRedo,
  onRetryGeneration,
  hasError = false,
  errorMessage,
  isGenerating = false,
  approvalGranted = false,
}) => {
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [reviewId, setReviewId] = React.useState<string | null>(null);
  const displayed = items ? items.map((item) => images.find((image) => image.itemId ? image.itemId === item.id : image.index === item.position) ?? {
    index: item.position, itemId: item.id, dataUrl: "", tempFilePath: "", status: "pending" as const,
  }) : images;
  const imageId = (image: GeneratedImage) => image.itemId ?? `position-${image.index}`;
  const reviewPosition = displayed.findIndex((image) => imageId(image) === reviewId);
  const reviewImage = displayed[reviewPosition];
  React.useEffect(() => {
    if (reviewId && reviewPosition < 0) setReviewId(null);
  }, [reviewId, reviewPosition]);
  const regenerationButtons = React.useRef<Record<number, HTMLButtonElement | null>>({});
  const closeEditor = (index: number): void => {
    setEditingIndex(null);
    requestAnimationFrame(() => regenerationButtons.current[index]?.focus());
  };
  // 完了枚数（進捗表示用、要件 2.5）
  const completedCount = images.filter((img) => img.status === "done").length;
  // プレビュー承認モードで承認待ちか（1 枚目のみ生成済みの状態、要件 2.2）
  const isAwaitingApproval =
    !isGenerating &&
    mode === "preview_approval" &&
    !approvalGranted &&
    completedCount >= 1 &&
    completedCount < totalCount;

  // 生成全体が失敗した場合はエラー表示と再実行ボタンのみ（要件 2.6）
  if (hasError) {
    return (
      <div className="image-preview-grid" role="alert">
        <p className="generation-error">
          {errorMessage ?? "画像の生成に失敗しました。もう一度お試しください。"}
        </p>
        {onRetryGeneration && (
          <button
            type="button"
            className="retry-generation-button"
            onClick={onRetryGeneration}
          >
            生成をやり直す
          </button>
        )}
      </div>
    );
  }

  const handleApproveStyle = (): void => {
    onApproveStyle?.(remainingCountForApproval(totalCount));
  };

  return (
    <div className="image-preview-grid">
      <PreviewBackgroundControls />
      {reviewImage && createPortal(<ImageReviewDialog key={reviewId}
        image={reviewImage}
        item={items?.find((item) => reviewImage.itemId ? item.id === reviewImage.itemId : item.position === reviewImage.index)}
        items={items} isGenerating={isGenerating}
        canGenerate={mode === "batch" || approvalGranted || reviewImage.index === 0}
        hasPrevious={reviewPosition > 0} hasNext={reviewPosition < displayed.length - 1}
        onClose={() => setReviewId(null)}
        onNavigate={(direction) => setReviewId(imageId(displayed[reviewPosition + direction]))}
        onRegenerate={() => onRegenerate(reviewImage.index)}
        onConfirm={onRegenerateWithEdits ? (edited) => onRegenerateWithEdits(reviewImage.index, edited) : undefined}
      />, document.body)}
      {/* 生成進捗（完了枚数 / 全体枚数）を 1 秒以内の更新間隔で表示（要件 2.5） */}
      <div
        className="generation-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalCount}
        aria-valuenow={completedCount}
        aria-live="polite"
        aria-label={`生成進捗 ${completedCount} / ${totalCount} 枚`}
      >
        生成済み {completedCount} / {totalCount} 枚
      </div>

      {/* 生成画像のグリッド表示（要件 2.6） */}
      <ul className="preview-grid" aria-label="生成画像一覧">
        {displayed.map((image) => (
          <li key={image.itemId ?? image.index} className="preview-item">
            {items && <p className="preview-item-label">{(image.itemId ? items.find((item) => item.id === image.itemId) : items.find((item) => item.position === image.index))?.meaning}</p>}
            {image.dataUrl && <p className="preview-item-text">生成に使った文字：{image.textSettings?.textEnabled ? `表示文字：${image.textSettings.displayText}` : "文字なし"}</p>}
            <button type="button" className="review-open-button" disabled={editingIndex !== null} aria-label={`画像 ${image.index + 1} を大きく表示`} onClick={() => setReviewId(imageId(image))}>大きく表示</button>
            {image.dataUrl && image.status !== "done" && <button type="button" className="preview-image-button" aria-label={`画像 ${image.index + 1} を確認`} onClick={() => setReviewId(imageId(image))}><PreviewImage className="preview-image" src={image.dataUrl} alt={`生成されたスタンプ画像 ${image.index + 1}`} /></button>}
            {image.status === "error" ? (
              // 個別画像のエラー状態と再試行ボタン（要件 2.8）
              <div className="preview-item-error" role="alert">
                <p>
                  {image.errorMessage ??
                    `画像 ${image.index + 1} の生成に失敗しました。`}
                </p>
                <button
                  type="button"
                  className="regenerate-button"
                  onClick={() => onRegenerate(image.index)}
                  disabled={isGenerating || editingIndex !== null}
                  aria-label={`画像 ${image.index + 1} を再試行`}
                >
                  再試行
                </button>
              </div>
            ) : image.status === "done" ? (
              <>
                <button type="button" className="preview-image-button" disabled={editingIndex !== null} aria-label={`画像 ${image.index + 1} を確認`} onClick={() => setReviewId(imageId(image))}><PreviewImage
                  className="preview-image"
                  src={image.dataUrl}
                  alt={`生成されたスタンプ画像 ${image.index + 1}`}
                /></button>
                <div className="preview-item-actions">
                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => onDelete(image.index)}
                    disabled={isGenerating || editingIndex !== null}
                    aria-label={`画像 ${image.index + 1} を削除`}
                  >
                    削除
                  </button>
                  <button
                    type="button"
                    className="regenerate-button"
                    ref={(element) => { regenerationButtons.current[image.index] = element; }}
                    onClick={() => {
                      if (onRegenerateWithEdits && items?.some((item) => item.position === image.index)) {
                        setEditingIndex(image.index);
                      } else {
                        onRegenerate(image.index);
                      }
                    }}
                    disabled={isGenerating || editingIndex !== null}
                    aria-label={`画像 ${image.index + 1} を再生成`}
                  >
                    再生成
                  </button>
                </div>
              </>
            ) : image.status === "pending" && (mode === "batch" || approvalGranted || image.index === 0) ? (
              <button type="button" className="regenerate-button" onClick={() => onRegenerate(image.index)} disabled={isGenerating || editingIndex !== null} aria-label={`画像 ${image.index + 1} を生成`}>
                生成する
              </button>
            ) : (
              // pending / generating 状態のプレースホルダ
              <div
                className="preview-item-loading"
                aria-label={`画像 ${image.index + 1} を生成中`}
              >
                <span>{image.status === "pending" ? "承認待ち" : "生成中..."}</span>
              </div>
            )}
            {editingIndex === image.index && !isGenerating && items && onRegenerateWithEdits && (
              <RegenerationEditor
                item={items.find((item) => item.position === image.index)!}
                items={items}
                onCancel={() => closeEditor(image.index)}
                onConfirm={(edited) => {
                  setEditingIndex(null);
                  onRegenerateWithEdits(image.index, edited);
                }}
              />
            )}
          </li>
        ))}
      </ul>

      {/* プレビュー承認モードの操作ボタン（要件 2.2, 2.3, 2.4） */}
      {isAwaitingApproval && (
        <div className="preview-approval-actions">
          <button
            type="button"
            className="approve-style-button"
            onClick={handleApproveStyle}
            disabled={editingIndex !== null}
          >
            このスタイルで残りを生成する
          </button>
          <button
            type="button"
            className="redo-button"
            onClick={() => onRedo?.()}
            disabled={editingIndex !== null}
          >
            やり直す
          </button>
        </div>
      )}
    </div>
  );
};

export default ImagePreviewGrid;
