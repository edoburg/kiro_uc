import React, { useEffect, useId, useRef, useState } from "react";
import type { Config } from "../types/index";

/**
 * SetupWizard コンポーネント（初回セットアップウィザード）
 *
 * Requirement 6.3:
 *   起動時に Config が存在しない、または APIキーが未設定である場合、
 *   初回セットアップウィザードを表示してユーザーを Config の初期設定へ誘導する。
 *
 * 設計方針:
 * - 表示可否は親（App）が算出して `visible` プロパティで渡す。
 *   本コンポーネントは `window.api` を直接呼び出さず、すべてコールバック経由で処理する。
 * - APIキーは認証情報として `onSaveCredential`（OS キーチェーン保存）へ渡し、
 *   Config（config.json）には決して含めない。ログ出力もしない（tech.md セキュリティルール）。
 * - ConfigPanel（15.1）とは独立し、import しない（並行実装のため）。
 */

/** AI エンジン選択肢（Config.aiEngine と対応） */
const AI_ENGINE_OPTIONS: ReadonlyArray<{
  value: Config["aiEngine"];
  label: string;
}> = [
  { value: "dalle", label: "DALL-E（OpenAI API）" },
  { value: "stable_diffusion", label: "Stable Diffusion（ローカル WebUI）" },
  { value: "midjourney", label: "Midjourney（API）" },
];

/**
 * 初回セットアップが必要かどうかを判定する純粋述語。
 *
 * Requirement 6.3:
 *   「Config が存在しない」または「APIキーが未設定」のいずれかを満たす場合に true。
 *
 * @param configConfigured     Config（config.json）が存在し初期化済みか
 * @param credentialConfigured APIキー（認証情報）が OS キーチェーンに保存済みか
 * @returns セットアップウィザードを表示すべきなら true
 */
export function needsSetup(
  configConfigured: boolean,
  credentialConfigured: boolean
): boolean {
  return !configConfigured || !credentialConfigured;
}

export interface SetupWizardProps {
  /** ウィザードを表示するかどうか（親が needsSetup 等で算出） */
  visible: boolean;
  /**
   * Config（APIキー・認証情報を除く）を保存するコールバック。
   * config.json への永続化を親（App → IPC → ConfigService）で行う。
   */
  onSaveConfig: (config: Config) => void | Promise<void>;
  /**
   * APIキー（認証情報）を保存するコールバック。
   * OS キーチェーンへの保存を親で行う。config.json には保存しない。
   */
  onSaveCredential: (apiKey: string) => void | Promise<void>;
  /** セットアップ完了時に呼ばれるコールバック（ウィザードを閉じる） */
  onComplete: () => void;
}

/** Config のうち、選択中エンジンに応じたデフォルト値を補完して返す */
function buildConfig(
  aiEngine: Config["aiEngine"],
  outputDirectory: string
): Config {
  return {
    aiEngine,
    outputDirectory: outputDirectory.trim(),
    // 各エンジンの詳細設定は Config 画面で調整する想定。ここでは既定値を設定する。
    dalleModel: "dall-e-3",
    sdEndpoint: "http://127.0.0.1:7860",
  };
}

/**
 * 初回セットアップウィザード。
 * AI エンジン選択 → APIキー入力 → 出力ディレクトリ設定 の必須項目を入力し、
 * 「セットアップを完了する」で Config・認証情報を保存する。
 */
const SetupWizard: React.FC<SetupWizardProps> = ({
  visible,
  onSaveConfig,
  onSaveCredential,
  onComplete,
}) => {
  const [aiEngine, setAiEngine] = useState<Config["aiEngine"]>("dalle");
  const [apiKey, setApiKey] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // 表示時に最初の操作要素へフォーカスを移す（アクセシビリティ）。
  useEffect(() => {
    if (visible) {
      dialogRef.current?.focus();
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  const handleComplete = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setError(null);

    // 必須項目（開始に最低限必要なもの）のバリデーション。
    if (apiKey.trim().length === 0) {
      setError("APIキーを入力してください");
      return;
    }
    if (outputDirectory.trim().length === 0) {
      setError("画像の出力先ディレクトリを指定してください");
      return;
    }

    setSaving(true);
    try {
      // Config（APIキーを含まない）を保存し、APIキーはキーチェーンへ保存する。
      await onSaveConfig(buildConfig(aiEngine, outputDirectory));
      await onSaveCredential(apiKey);
      onComplete();
    } catch {
      // 例外の詳細（APIキーを含みうる）はここでは出力しない。
      setError("設定の保存に失敗しました。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="setup-wizard__overlay">
      <div
        ref={dialogRef}
        className="setup-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
      >
        <h1 id={titleId} className="setup-wizard__title">
          初回セットアップ
        </h1>
        <p id={descId} className="setup-wizard__description">
          スタンプ生成を始めるための基本設定を行います。使用する AI エンジン、
          APIキー、画像の出力先を設定してください。
        </p>

        <form className="setup-wizard__form" onSubmit={handleComplete}>
          {/* AI エンジン選択 */}
          <div className="setup-wizard__field">
            <label htmlFor="setup-wizard-engine">AI エンジン</label>
            <select
              id="setup-wizard-engine"
              value={aiEngine}
              onChange={(e) =>
                setAiEngine(e.target.value as Config["aiEngine"])
              }
            >
              {AI_ENGINE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* APIキー入力（認証情報 → キーチェーン保存） */}
          <div className="setup-wizard__field">
            <label htmlFor="setup-wizard-api-key">APIキー</label>
            <input
              id="setup-wizard-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="選択したエンジンのAPIキーを入力"
              aria-required="true"
            />
            <p className="setup-wizard__hint">
              APIキーは OS のキーチェーンに安全に保存され、設定ファイルには保存されません。
            </p>
          </div>

          {/* 出力ディレクトリ設定 */}
          <div className="setup-wizard__field">
            <label htmlFor="setup-wizard-output-dir">画像の出力先ディレクトリ</label>
            <input
              id="setup-wizard-output-dir"
              type="text"
              value={outputDirectory}
              onChange={(e) => setOutputDirectory(e.target.value)}
              placeholder="例: /Users/you/line-stamps"
              aria-required="true"
            />
          </div>

          {/* エラーメッセージ */}
          {error && (
            <p className="setup-wizard__error" role="alert">
              {error}
            </p>
          )}

          <div className="setup-wizard__actions">
            <button
              type="submit"
              className="setup-wizard__complete-button"
              disabled={saving}
              aria-disabled={saving}
            >
              {saving ? "保存中..." : "セットアップを完了する"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SetupWizard;
