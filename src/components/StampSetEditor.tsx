import React, { useMemo, useRef, useState } from "react";
import type { StampSet } from "../types/index";
import {
  validateDescription,
  validateFileType,
  validateTitle,
} from "../utils/validation";

/** タイトル最大文字数（要件 4.2 / LINE 規格） */
const MAX_TITLE_LENGTH = 40;

/** 説明最大文字数（要件 4.3） */
const MAX_DESCRIPTION_LENGTH = 160;

/** 差し替えで受け付ける MIME タイプ（要件 4.4, 4.5） */
const PNG_MIME_TYPE = "image/png";

/**
 * StampSetEditor の Props。
 *
 * 設計 (design.md) の契約に準拠する。
 * - stampSet: 表示・編集対象のスタンプセット
 * - onTitleChange / onDescriptionChange: メタデータ変更の通知（親が状態を保持）
 * - onReplaceImage: 個別画像の差し替え（PNG のみ、要件 4.4〜4.6）
 * - onExport: エクスポート先パスを受け取りエクスポートを開始（要件 4.7, 4.8）
 * - onUpload: アップロード開始（要件 5.6 のボタン活性制御に isValidForUpload を使用）
 */
export interface StampSetEditorProps {
  /** 表示・編集対象のスタンプセット */
  stampSet: StampSet;
  /** タイトル変更時に呼ばれる（要件 4.2） */
  onTitleChange: (title: string) => void;
  /** 説明変更時に呼ばれる（要件 4.3） */
  onDescriptionChange: (description: string) => void;
  /** 個別スタンプ画像の差し替え（PNG のみ、要件 4.4, 4.6） */
  onReplaceImage: (index: number, file: File) => void;
  /** エクスポート開始（タイトル検証通過時のみ、要件 4.7, 4.8） */
  onExport: (outputPath: string) => void;
  /** アップロード開始（要件 5.1, 5.6） */
  onUpload: () => void;
}

/**
 * StampSetEditor
 *
 * スタンプセットのプレビュー一覧表示・メタデータ編集・画像差し替え・
 * エクスポート／アップロードを提供するコンポーネント。
 *
 * - 全スタンプ画像・メイン画像・サムネイル画像を一覧表示（要件 4.1）
 * - タイトル入力: 1〜40 文字、リアルタイム文字数・エラー表示（要件 4.2）
 * - 説明入力: 0〜160 文字、リアルタイム文字数・エラー表示（要件 4.3）
 * - 個別画像差し替え: PNG のみ選択可、PNG 以外はエラー表示（要件 4.4, 4.5）
 * - エクスポート: タイトル検証通過時のみ ZIP 化を開始（要件 4.7, 4.8）
 * - アップロード: LINE 規格未通過時はボタン無効化（要件 5.6）
 *
 * ユーザー向けテキストはすべて日本語。
 */
const StampSetEditor: React.FC<StampSetEditorProps> = ({
  stampSet,
  onTitleChange,
  onDescriptionChange,
  onReplaceImage,
  onExport,
  onUpload,
}) => {
  // 差し替え対象の隠しファイル入力を画像ごとに参照する
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  // 画像ごとの差し替えエラーメッセージ（要件 4.5）
  const [replaceErrors, setReplaceErrors] = useState<Record<number, string>>(
    {},
  );

  // リアルタイムのタイトル／説明バリデーション（要件 4.2, 4.3）
  const titleError = useMemo(
    () => validateTitle(stampSet.title),
    [stampSet.title],
  );
  const descriptionError = useMemo(
    () => validateDescription(stampSet.description),
    [stampSet.description],
  );

  // エクスポートはタイトル検証通過時のみ許可（要件 4.7）
  const isExportDisabled = titleError !== null;

  const handleReplaceClick = (index: number): void => {
    fileInputRefs.current[index]?.click();
  };

  const handleFileSelected = (
    index: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    // 同じファイルを再選択しても onChange が発火するよう値をリセット
    event.target.value = "";
    if (!file) {
      return;
    }

    // PNG 以外は差し替えを中断しエラーを表示する（要件 4.5）
    // 拡張子（validateFileType）と MIME タイプの両方で判定する
    const extensionError = validateFileType(file.name);
    const isPng = extensionError === null && file.type === PNG_MIME_TYPE;
    if (!isPng) {
      setReplaceErrors((prev) => ({
        ...prev,
        [index]: "PNG形式のファイルを選択してください",
      }));
      return;
    }

    // 検証通過: エラーを解除し差し替えを親へ通知（要件 4.6）
    setReplaceErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    onReplaceImage(index, file);
  };

  const handleExport = (): void => {
    // タイトル検証を通過しない限りエクスポートを開始しない（要件 4.7）
    if (validateTitle(stampSet.title) !== null) {
      return;
    }

    // エクスポート先をユーザーに指定させる（実際のダイアログは IPC 経由）
    const outputPath =
      typeof window !== "undefined" && typeof window.prompt === "function"
        ? window.prompt("エクスポート先のパスを入力してください")
        : "";
    if (!outputPath) {
      return;
    }
    onExport(outputPath);
  };

  return (
    <section className="stamp-set-editor" aria-label="スタンプセット編集">
      {/* --- メタデータ入力（要件 4.2, 4.3） --- */}
      <div className="stamp-set-editor__meta">
        <div className="stamp-set-editor__field">
          <label htmlFor="stamp-set-title">タイトル（1〜40文字）</label>
          <input
            id="stamp-set-title"
            name="title"
            type="text"
            value={stampSet.title}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-invalid={titleError !== null}
            aria-describedby="stamp-set-title-count stamp-set-title-error"
          />
          <div
            id="stamp-set-title-count"
            className={`stamp-set-editor__char-count${
              titleError !== null ? " is-invalid" : ""
            }`}
            aria-live="polite"
          >
            {stampSet.title.length} / {MAX_TITLE_LENGTH} 文字
          </div>
          {titleError && (
            <p
              id="stamp-set-title-error"
              className="stamp-set-editor__error"
              role="alert"
            >
              {titleError.message}
            </p>
          )}
        </div>

        <div className="stamp-set-editor__field">
          <label htmlFor="stamp-set-description">説明（0〜160文字・任意）</label>
          <textarea
            id="stamp-set-description"
            name="description"
            value={stampSet.description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={3}
            aria-invalid={descriptionError !== null}
            aria-describedby="stamp-set-description-count stamp-set-description-error"
          />
          <div
            id="stamp-set-description-count"
            className={`stamp-set-editor__char-count${
              descriptionError !== null ? " is-invalid" : ""
            }`}
            aria-live="polite"
          >
            {stampSet.description.length} / {MAX_DESCRIPTION_LENGTH} 文字
          </div>
          {descriptionError && (
            <p
              id="stamp-set-description-error"
              className="stamp-set-editor__error"
              role="alert"
            >
              {descriptionError.message}
            </p>
          )}
        </div>
      </div>

      {/* --- スタンプ画像プレビュー一覧（要件 4.1） --- */}
      <ul className="stamp-set-editor__grid" aria-label="スタンプ画像一覧">
        {stampSet.images.map((image, index) => {
          const replaceError = replaceErrors[index];
          const errorId = `stamp-replace-error-${index}`;
          return (
            <li key={index} className="stamp-set-editor__item">
              <div className="stamp-set-editor__previews">
                <img
                  className="stamp-set-editor__preview stamp-set-editor__preview--stamp"
                  src={image.stampPath}
                  alt={`スタンプ画像 ${index + 1}`}
                />
                <img
                  className="stamp-set-editor__preview stamp-set-editor__preview--main"
                  src={image.mainImagePath}
                  alt={`メイン画像 ${index + 1}`}
                />
                <img
                  className="stamp-set-editor__preview stamp-set-editor__preview--thumb"
                  src={image.thumbnailPath}
                  alt={`サムネイル画像 ${index + 1}`}
                />
              </div>

              {/* LINE 規格バリデーション結果の表示（要件 3.4） */}
              <p
                className={`stamp-set-editor__validation${
                  image.validationResult.passed ? " is-ok" : " is-ng"
                }`}
              >
                {image.validationResult.passed
                  ? "LINE規格: 適合"
                  : `LINE規格: 不適合（${image.validationResult.details}）`}
              </p>

              {/* 画像差し替え（PNG のみ、要件 4.4〜4.6） */}
              <input
                ref={(el) => {
                  fileInputRefs.current[index] = el;
                }}
                type="file"
                accept="image/png,.png"
                className="stamp-set-editor__file-input"
                style={{ display: "none" }}
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => handleFileSelected(index, e)}
              />
              <button
                type="button"
                className="stamp-set-editor__replace-button"
                onClick={() => handleReplaceClick(index)}
                aria-label={`スタンプ画像 ${index + 1} を差し替え`}
                aria-describedby={replaceError ? errorId : undefined}
              >
                差し替え
              </button>
              {replaceError && (
                <p
                  id={errorId}
                  className="stamp-set-editor__error"
                  role="alert"
                >
                  {replaceError}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* --- エクスポート／アップロード操作（要件 4.7, 4.8, 5.6） --- */}
      <div className="stamp-set-editor__actions">
        <button
          type="button"
          className="stamp-set-editor__export-button"
          onClick={handleExport}
          disabled={isExportDisabled}
        >
          エクスポート（ZIP保存）
        </button>
        <button
          type="button"
          className="stamp-set-editor__upload-button"
          onClick={onUpload}
          disabled={!stampSet.isValidForUpload}
        >
          LINE Creators Market へアップロード
        </button>
      </div>
    </section>
  );
};

export default StampSetEditor;
