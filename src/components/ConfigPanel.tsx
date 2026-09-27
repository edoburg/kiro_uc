import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Config } from "../types/index";

/**
 * OS キーチェーンに保存するクレデンシャルのキー名。
 * 値そのもの（APIキー・パスワード）は Config には含めず、キーチェーンにのみ保存する。
 */
export const CREDENTIAL_KEYS = {
  /** AI 画像生成 API キー（OpenAI / Midjourney など） */
  aiApiKey: "ai_api_key",
  /** LINE Creators Market ログインメールアドレス */
  lineEmail: "line_email",
  /** LINE Creators Market ログインパスワード */
  linePassword: "line_password",
} as const;

/** AI エンジンの選択肢と日本語ラベル（要件 6.1） */
const AI_ENGINE_OPTIONS: ReadonlyArray<{ value: Config["aiEngine"]; label: string }> = [
  { value: "openai", label: "OpenAI（gpt-image-2.5）" },
  { value: "stable_diffusion", label: "Stable Diffusion（ローカル WebUI）" },
  { value: "midjourney", label: "Midjourney" },
];

/** OpenAI（gpt-image-2.5）モデルの選択肢と日本語ラベル（要件 6.1） */
const OPENAI_MODEL_OPTIONS: ReadonlyArray<{
  value: Config["openaiModel"];
  label: string;
}> = [
  { value: "gpt-image-2.5-flare", label: "gpt-image-2.5-flare（速度優先）" },
  { value: "gpt-image-2.5-sunburst", label: "gpt-image-2.5-sunburst（品質優先）" },
];

/** Config オブジェクトに含めてはならない、認証情報系のフィールド名（要件 6.5） */
const SENSITIVE_FIELDS: ReadonlyArray<string> = [
  "api_key",
  "apiKey",
  "password",
  "credential",
  "credentials",
  "secret",
  "token",
];

export interface ConfigPanelProps {
  /** 現在の設定（初期値）。未取得の場合は null を渡せる。 */
  config: Config | null;
  /** AI 画像生成用の API キーがキーチェーンに設定済みか（値は渡さない） */
  aiApiKeyConfigured?: boolean;
  /**
   * 設定を保存する（config.json への書き込み）。
   * 認証情報は含まない Config のみを渡す。成功時は解決、失敗時は reject。
   */
  onSaveConfig: (config: Config) => Promise<void>;
  /**
   * クレデンシャルを OS キーチェーンに保存する（要件 6.2）。
   * value は Config には決して含めず、この経路のみでキーチェーンへ渡す。
   */
  onSaveCredential: (key: string, value: string) => Promise<void>;
  /**
   * 設定をエクスポートする（要件 6.5）。
   * 返却値はバックエンドの export_sanitized() により認証情報が除外済みの JSON オブジェクト。
   */
  onExportConfig: () => Promise<Record<string, unknown>>;
  /**
   * 設定をインポートする（要件 6.6）。
   * スキーマ検証はバックエンドでも行われるが、フロント側でも事前検証する。
   */
  onImportConfig: (data: Record<string, unknown>) => Promise<void>;
}

/**
 * import 対象データが Config スキーマを満たすかを検証する純粋関数（要件 6.6, 6.7）。
 *
 * - 必須フィールド（aiEngine / outputDirectory / openaiModel / sdEndpoint）の型を確認する。
 * - 認証情報系フィールド（api_key / password 等）が含まれていないことを確認する。
 *
 * 検証に失敗した場合はエラーメッセージ（日本語）を返し、成功した場合は null を返す。
 */
export function validateImportedConfig(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "設定ファイルの形式が正しくありません。";
  }
  const obj = data as Record<string, unknown>;

  // 認証情報が含まれていないことを確認する（要件 6.5 の趣旨に反するデータを拒否）
  for (const field of SENSITIVE_FIELDS) {
    if (field in obj) {
      return "設定ファイルに認証情報が含まれています。認証情報を含むファイルはインポートできません。";
    }
  }

  const validEngines: ReadonlyArray<Config["aiEngine"]> = [
    "openai",
    "stable_diffusion",
    "midjourney",
  ];
  if (typeof obj.aiEngine !== "string" || !validEngines.includes(obj.aiEngine as Config["aiEngine"])) {
    return "AI エンジンの設定値が不正です。";
  }
  if (typeof obj.outputDirectory !== "string") {
    return "出力ディレクトリの設定値が不正です。";
  }
  if (typeof obj.openaiModel !== "string") {
    return "OpenAI モデルの設定値が不正です。";
  }
  if (typeof obj.sdEndpoint !== "string") {
    return "Stable Diffusion エンドポイントの設定値が不正です。";
  }

  return null;
}

/** 空の Config（config 未取得時の初期値） */
const EMPTY_CONFIG: Config = {
  aiEngine: "openai",
  outputDirectory: "",
  openaiModel: "gpt-image-2.5-flare",
  sdEndpoint: "",
};

/**
 * ConfigPanel
 *
 * アプリ設定画面（要件 6）。
 * - AI エンジン選択（openai / stable_diffusion / midjourney）（要件 6.1）
 * - API キー入力（キーチェーン保存、Config には含めない）（要件 6.1, 6.2）
 * - 出力ディレクトリ設定（要件 6.1）
 * - Config エクスポート／インポート（要件 6.5, 6.6, 6.7）
 * - 保存成功時に「設定を保存しました」を表示（要件 6.4）
 *
 * セキュリティ（tech.md）:
 *   API キーは onSaveCredential 経由でキーチェーンにのみ保存し、
 *   保存する Config オブジェクトにもエクスポート内容にも含めない。ログにも出力しない。
 *
 * ユーザー向けテキストはすべて日本語。
 */
const ConfigPanel: React.FC<ConfigPanelProps> = ({
  config,
  aiApiKeyConfigured = false,
  onSaveConfig,
  onSaveCredential,
  onExportConfig,
  onImportConfig,
}) => {
  // Config フィールドの編集状態（認証情報は含めない）
  // 不完全な config（旧スキーマ・欠損フィールド）でも壊れないよう EMPTY_CONFIG で補完する
  const [form, setForm] = useState<Config>({ ...EMPTY_CONFIG, ...(config ?? {}) });
  // API キー入力（Config には保存せず、キーチェーンにのみ送る）
  const [apiKey, setApiKey] = useState<string>("");

  // 親から渡される config が変化したらフォームへ反映する（欠損フィールドは補完する）
  useEffect(() => {
    if (config) {
      setForm({ ...EMPTY_CONFIG, ...config });
    }
  }, [config]);

  // 保存成功メッセージ（要件 6.4）／エラーメッセージ
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // インポート用の隠しファイル入力
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // 出力ディレクトリ未入力時は保存不可（要件 6.1）
  const isSaveDisabled = useMemo(
    () => isSaving || form.outputDirectory.trim().length === 0,
    [isSaving, form.outputDirectory],
  );

  const updateField = <K extends keyof Config>(key: K, value: Config[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // 入力が変わったら通知メッセージをクリアする
    setSuccessMessage(null);
    setErrorMessage(null);
  };

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      // 1) API キーが入力されていればキーチェーンへ保存する（Config には含めない）（要件 6.2）
      const trimmedKey = apiKey.trim();
      if (trimmedKey.length > 0) {
        await onSaveCredential(CREDENTIAL_KEYS.aiApiKey, trimmedKey);
      }

      // 2) 認証情報を含まない Config のみを保存する（要件 6.4）
      await onSaveConfig({ ...form });

      // 3) メモリ上の API キー入力をクリアする（画面に残さない）
      setApiKey("");
      setSuccessMessage("設定を保存しました");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "設定の保存に失敗しました。",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async (): Promise<void> => {
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      // バックエンドの export_sanitized() が認証情報を除外済みの JSON を返す（要件 6.5）
      const sanitized = await onExportConfig();
      const json = JSON.stringify(sanitized, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "line-stamp-gen-config.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccessMessage("設定をエクスポートしました");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "設定のエクスポートに失敗しました。",
      );
    }
  };

  const handleImportClick = (): void => {
    importInputRef.current?.click();
  };

  const handleImportFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    // 同じファイルを再選択しても onChange が発火するよう値をリセット
    event.target.value = "";
    if (!file) {
      return;
    }
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // 不正 JSON: 既存 Config は変更しない（要件 6.7）
        setErrorMessage("設定ファイルの JSON 形式が不正です。既存の設定は変更されていません。");
        return;
      }

      // スキーマ検証（要件 6.6, 6.7）
      const validationError = validateImportedConfig(parsed);
      if (validationError) {
        setErrorMessage(`${validationError} 既存の設定は変更されていません。`);
        return;
      }

      // 検証通過: バックエンドへインポートを依頼し、上書き後の内容をフォームへ反映する（要件 6.6）
      const data = parsed as Record<string, unknown>;
      await onImportConfig(data);
      setForm({
        aiEngine: data.aiEngine as Config["aiEngine"],
        outputDirectory: data.outputDirectory as string,
        openaiModel: data.openaiModel as Config["openaiModel"],
        sdEndpoint: data.sdEndpoint as string,
      });
      setSuccessMessage("設定をインポートしました");
    } catch (err) {
      // バックエンド側の検証失敗等: 既存 Config は変更されない（要件 6.7）
      setErrorMessage(
        err instanceof Error
          ? `${err.message} 既存の設定は変更されていません。`
          : "設定のインポートに失敗しました。既存の設定は変更されていません。",
      );
    }
  };

  const apiKeyPlaceholder = aiApiKeyConfigured
    ? "設定済み（変更する場合のみ入力）"
    : "APIキーを入力";

  return (
    <section className="config-panel" aria-label="アプリ設定">
      <h2>設定</h2>

      {/* --- AI エンジン選択（要件 6.1） --- */}
      <div className="config-panel__field">
        <label htmlFor="config-ai-engine">AI 画像生成エンジン</label>
        <select
          id="config-ai-engine"
          name="aiEngine"
          value={form.aiEngine}
          onChange={(e) => updateField("aiEngine", e.target.value as Config["aiEngine"])}
        >
          {AI_ENGINE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* --- API キー入力（キーチェーン保存、Config には含めない）（要件 6.1, 6.2） --- */}
      <div className="config-panel__field">
        <label htmlFor="config-api-key">API キー</label>
        <input
          id="config-api-key"
          name="apiKey"
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={apiKeyPlaceholder}
          onChange={(e) => {
            setApiKey(e.target.value);
            setSuccessMessage(null);
            setErrorMessage(null);
          }}
          aria-describedby="config-api-key-note"
        />
        <p id="config-api-key-note" className="config-panel__note">
          API キーは OS のキーチェーンに安全に保存され、設定ファイルやエクスポートには含まれません。
        </p>
      </div>

      {/* --- OpenAI モデル（aiEngine が openai のとき有効） --- */}
      <div className="config-panel__field">
        <label htmlFor="config-openai-model">OpenAI モデル</label>
        <select
          id="config-openai-model"
          name="openaiModel"
          value={form.openaiModel}
          onChange={(e) =>
            updateField("openaiModel", e.target.value as Config["openaiModel"])
          }
          disabled={form.aiEngine !== "openai"}
        >
          {OPENAI_MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* --- Stable Diffusion エンドポイント（aiEngine が stable_diffusion のとき有効） --- */}
      <div className="config-panel__field">
        <label htmlFor="config-sd-endpoint">Stable Diffusion エンドポイント</label>
        <input
          id="config-sd-endpoint"
          name="sdEndpoint"
          type="text"
          value={form.sdEndpoint}
          placeholder="http://127.0.0.1:7860"
          onChange={(e) => updateField("sdEndpoint", e.target.value)}
          disabled={form.aiEngine !== "stable_diffusion"}
        />
      </div>

      {/* --- 出力ディレクトリ（要件 6.1） --- */}
      <div className="config-panel__field">
        <label htmlFor="config-output-directory">画像出力先ディレクトリ</label>
        <input
          id="config-output-directory"
          name="outputDirectory"
          type="text"
          value={form.outputDirectory}
          placeholder="例: /Users/name/line-stamps"
          onChange={(e) => updateField("outputDirectory", e.target.value)}
          aria-invalid={form.outputDirectory.trim().length === 0}
          aria-describedby="config-output-directory-error"
        />
        {form.outputDirectory.trim().length === 0 && (
          <p
            id="config-output-directory-error"
            className="config-panel__error"
            role="alert"
          >
            出力先ディレクトリを入力してください。
          </p>
        )}
      </div>

      {/* --- 保存／エクスポート／インポート操作 --- */}
      <div className="config-panel__actions">
        <button
          type="button"
          className="config-panel__save-button"
          onClick={handleSave}
          disabled={isSaveDisabled}
        >
          {isSaving ? "保存中..." : "設定を保存"}
        </button>
        <button
          type="button"
          className="config-panel__export-button"
          onClick={handleExport}
        >
          設定をエクスポート
        </button>
        <button
          type="button"
          className="config-panel__import-button"
          onClick={handleImportClick}
        >
          設定をインポート
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="config-panel__import-input"
          style={{ display: "none" }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={handleImportFileSelected}
        />
      </div>

      {/* --- 通知メッセージ（要件 6.4, 6.7） --- */}
      {successMessage && (
        <p className="config-panel__success" role="status" aria-live="polite">
          {successMessage}
        </p>
      )}
      {errorMessage && (
        <p className="config-panel__error" role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  );
};

export default ConfigPanel;
