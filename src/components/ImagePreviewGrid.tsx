import React from "react";
import type { GeneratedImage, GenerationMode } from "../types/index";

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
  /** 生成モード（"batch" | "preview_approval"） */
  mode: GenerationMode;
  /** 生成予定の総枚数（進捗表示・残り枚数算出に使用） */
  totalCount: number;
  /** 個別画像の削除（要件 2.9） */
  onDelete: (index: number) => void;
  /** 個別画像の再生成（元の Prompt・スタイルを使用、要件 2.9） */
  onRegenerate: (index: number) => void;
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
  mode,
  totalCount,
  onDelete,
  onRegenerate,
  onApproveStyle,
  onRedo,
  onRetryGeneration,
  hasError = false,
  errorMessage,
}) => {
  // 完了枚数（進捗表示用、要件 2.5）
  const completedCount = images.filter((img) => img.status === "done").length;
  // プレビュー承認モードで承認待ちか（1 枚目のみ生成済みの状態、要件 2.2）
  const isAwaitingApproval =
    mode === "preview_approval" && completedCount >= 1 && totalCount > 1;

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
        {images.map((image) => (
          <li key={image.index} className="preview-item">
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
                  aria-label={`画像 ${image.index + 1} を再試行`}
                >
                  再試行
                </button>
              </div>
            ) : image.status === "done" ? (
              <>
                <img
                  className="preview-image"
                  src={image.dataUrl}
                  alt={`生成されたスタンプ画像 ${image.index + 1}`}
                />
                <div className="preview-item-actions">
                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => onDelete(image.index)}
                    aria-label={`画像 ${image.index + 1} を削除`}
                  >
                    削除
                  </button>
                  <button
                    type="button"
                    className="regenerate-button"
                    onClick={() => onRegenerate(image.index)}
                    aria-label={`画像 ${image.index + 1} を再生成`}
                  >
                    再生成
                  </button>
                </div>
              </>
            ) : (
              // pending / generating 状態のプレースホルダ
              <div
                className="preview-item-loading"
                aria-label={`画像 ${image.index + 1} を生成中`}
              >
                <span>生成中...</span>
              </div>
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
          >
            このスタイルで残りを生成する
          </button>
          <button
            type="button"
            className="redo-button"
            onClick={() => onRedo?.()}
          >
            やり直す
          </button>
        </div>
      )}
    </div>
  );
};

export default ImagePreviewGrid;
