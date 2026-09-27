import React from "react";
import type { UploadResult } from "../types/index";
import type { UploadProgressPayload } from "../types/ipc";

/**
 * アップロード進捗情報。
 * バックエンド（UploaderService の UploadProgress）の形状に合わせたフロントエンド用の型。
 * 現時点で `src/types/index.ts` に共有型が存在しないため、ここでローカル定義する。
 */
export type UploadProgress = UploadProgressPayload;

export interface UploadPanelProps {
  /** LINE 規格バリデーション全通過フラグ（StampSet.isValidForUpload） */
  isValidForUpload: boolean;
  /** 認証情報が OS キーチェーンに設定済みかどうか */
  credentialsConfigured: boolean;
  /** アップロード進捗（アップロード中のみ非 null） */
  progress?: UploadProgress | null;
  /** アップロード結果（完了後のみ非 null） */
  result?: UploadResult | null;
  /** アップロード開始ハンドラ */
  onUpload: () => void;
}

/**
 * アップロードボタンを活性化してよいかを判定する純粋述語。
 *
 * - LINE 規格バリデーション未通過（`isValidForUpload == false`）の場合は常に false。
 * - 認証情報が未設定の場合も false（アップロードを開始させない）。
 *
 * Property 12（バリデーション状態とアップロードボタンの連動）のテスト対象。
 */
export function canUpload(
  isValidForUpload: boolean,
  credentialsConfigured: boolean
): boolean {
  return isValidForUpload && credentialsConfigured;
}

/** エラー種別ごとの日本語メッセージ（ユーザー向け） */
const ERROR_TYPE_LABEL: Record<
  NonNullable<UploadResult["errorType"]>,
  string
> = {
  network: "ネットワークエラーが発生しました。通信環境を確認して再試行してください。",
  auth: "認証エラーが発生しました。認証情報が正しいか、有効期限が切れていないか確認してください。",
  validation: "アップロード内容がLINE規格を満たしていません。スタンプセットの内容を確認してください。",
  unknown: "不明なエラーが発生しました。しばらくしてから再試行してください。",
};

/**
 * UploadPanel コンポーネント。
 *
 * - アップロード進捗バー（Requirement 5.2）
 * - Upload_Result 表示（成功: 申請ID・ステータス / 失敗: エラー種別・日本語メッセージ）（Requirement 5.3, 5.4, 5.7）
 * - 認証情報未設定メッセージ（Requirement 5.8）
 * - アップロードボタンの活性制御（Requirement 5.1, 5.6, 5.8）
 */
const UploadPanel: React.FC<UploadPanelProps> = ({
  isValidForUpload,
  credentialsConfigured,
  progress,
  result,
  onUpload,
}) => {
  const uploadable = canUpload(isValidForUpload, credentialsConfigured);
  const isUploading = !!progress && progress.phase !== "done";

  const handleUploadClick = (): void => {
    // 認証情報未設定時はアップロードを開始しない（Requirement 5.8）。
    // ボタンは disabled だが、防御的に二重チェックする。
    if (!uploadable) {
      return;
    }
    onUpload();
  };

  // プログレスバー用のパーセンテージ（0〜100）
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;

  return (
    <section className="upload-panel" aria-label="アップロード">
      <h2>LINE Creators Market へのアップロード</h2>

      {/* 認証情報未設定メッセージ（Requirement 5.8） */}
      {!credentialsConfigured && (
        <p className="upload-panel__credentials-warning" role="alert">
          LINE Creators Market の認証情報が設定されていません。設定画面から認証情報を登録してください。
        </p>
      )}

      {/* バリデーション未通過メッセージ（Requirement 5.6） */}
      {credentialsConfigured && !isValidForUpload && (
        <p className="upload-panel__validation-warning" role="alert">
          スタンプセットがLINE規格を満たしていません。すべての画像がバリデーションを通過するとアップロードできます。
        </p>
      )}

      {/* アップロードボタン（Requirement 5.1, 5.6, 5.8） */}
      <button
        type="button"
        className="upload-panel__upload-button"
        onClick={handleUploadClick}
        disabled={!uploadable || isUploading}
        aria-disabled={!uploadable || isUploading}
      >
        {isUploading ? "アップロード中..." : "アップロードする"}
      </button>

      {/* アップロード進捗バー（Requirement 5.2） */}
      {progress && (
        <div className="upload-panel__progress">
          <p className="upload-panel__progress-message">{progress.message}</p>
          <div
            className="upload-panel__progress-bar"
            role="progressbar"
            aria-label="アップロード進捗"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}%（${progress.completed}/${progress.total}）`}
          >
            <div
              className="upload-panel__progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="upload-panel__progress-count">
            {progress.completed}/{progress.total}
          </span>
        </div>
      )}

      {/* Upload_Result 表示（Requirement 5.3, 5.4, 5.7） */}
      {result && (
        <div className="upload-panel__result">
          {result.success ? (
            <div className="upload-panel__result--success" role="status">
              <p>アップロードが完了しました。</p>
              {result.applicationId && (
                <p>
                  申請ID: <strong>{result.applicationId}</strong>
                </p>
              )}
              {result.status && (
                <p>
                  ステータス: <strong>{result.status}</strong>
                </p>
              )}
            </div>
          ) : (
            <div className="upload-panel__result--error" role="alert">
              <p>アップロードに失敗しました。</p>
              {result.errorType && <p>{ERROR_TYPE_LABEL[result.errorType]}</p>}
              {/* バックエンドが返した詳細な日本語メッセージ */}
              {result.errorMessage && (
                <p className="upload-panel__result-detail">
                  {result.errorMessage}
                </p>
              )}
              {/* ネットワークエラー時のリトライ回数表示（Requirement 5.4） */}
              {result.errorType === "network" && (
                <p className="upload-panel__retry-count">
                  自動リトライ回数: {result.retryCount} 回
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default UploadPanel;
