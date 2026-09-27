import React, { useCallback, useEffect } from "react";
import type {
  Config,
  GenerationRequest,
} from "./types/index";
import type {
  GenerationStreamPayload,
  UploadStreamPayload,
} from "./types/window-api";

import PromptInput from "./components/PromptInput";
import ImagePreviewGrid from "./components/ImagePreviewGrid";
import StampSetEditor from "./components/StampSetEditor";
import UploadPanel from "./components/UploadPanel";
import ConfigPanel from "./components/ConfigPanel";
import SetupWizard, { needsSetup } from "./components/SetupWizard";
import LogViewer from "./components/LogViewer";
import type { LogFilter } from "./components/LogViewer";

import { usePromptHistoryStore } from "./stores/promptHistoryStore";
import { CREDENTIAL_KEYS } from "./components/ConfigPanel";
import {
  AppStoreProvider,
  useAppStore,
} from "./stores/appStore";
import type { LogEntry } from "./types/index";
import {
  toExportCreateRequest,
  toUploadErrorResult,
  toUploadResult,
  toUploadStartRequest,
} from "./utils/ipcMappers";
import {
  buildStampSetFromGeneratedImages,
  toStampImage,
} from "./utils/stampSet";
import { LINE_CREATORS_UPLOAD_ENABLED } from "./config/features";

/**
 * window.api が存在するときのみ callback を実行する小さなガード。
 * テスト・開発（Electron 外）では window.api が undefined のため、静かにスキップする。
 */
function withApi<T>(
  fn: (api: NonNullable<Window["api"]>) => Promise<T> | T,
): Promise<T> | undefined {
  const api = typeof window !== "undefined" ? window.api : undefined;
  if (!api) {
    return undefined;
  }
  return Promise.resolve(fn(api));
}

/**
 * 例外を日本語メッセージへ整形する。
 * バックエンド（FastAPI detail）由来の日本語メッセージがあればそれを優先する。
 */
function toJapaneseError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === "string" && err.length > 0) {
    return err;
  }
  return fallback;
}

/**
 * LINEスタンプジェネレーター ルートコンポーネント（内部実装）。
 *
 * 生成フロー: PromptInput → ImagePreviewGrid → StampSetEditor → UploadPanel
 * 補助画面 : SetupWizard（初回セットアップ）・ConfigPanel（設定）・LogViewer（ログ）
 *
 * グローバル状態は AppStoreProvider（React Context + useReducer）で共有する。
 * バックエンドへの呼び出しはすべて window.api（preload）経由（structure.md の IPC 境界）。
 */
const AppInner: React.FC = () => {
  const { state, dispatch } = useAppStore();
  const history = usePromptHistoryStore((s) => s.entries);
  const addHistory = usePromptHistoryStore((s) => s.add);

  const setError = useCallback(
    (message: string | null) =>
      dispatch({ type: "SET_ERROR", message }),
    [dispatch],
  );
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportMessage, setExportMessage] = React.useState<string | null>(null);

  useEffect(() => {
    setExportMessage(null);
  }, [state.stampSet]);

  // --- 起動時: Config・クレデンシャルの状態を取得してセットアップ要否を判定（要件 6.3） ---
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      const api = typeof window !== "undefined" ? window.api : undefined;
      if (!api) {
        // Electron 外（テスト/開発）: セットアップウィザードを表示したまま待機する
        return;
      }
      try {
        const config = api.config?.get
          ? await api.config.get()
          : null;
        const aiKey = api.credential?.get
          ? await api.credential.get(CREDENTIAL_KEYS.aiApiKey)
          : null;
        const lineEmail = api.credential?.get
          ? await api.credential.get(CREDENTIAL_KEYS.lineEmail)
          : null;
        const linePassword = api.credential?.get
          ? await api.credential.get(CREDENTIAL_KEYS.linePassword)
          : null;

        if (cancelled) {
          return;
        }

        const aiConfigured = isCredentialConfigured(aiKey);
        const lineConfigured =
          isCredentialConfigured(lineEmail) &&
          isCredentialConfigured(linePassword);
        const configExists = config != null;

        if (config) {
          dispatch({ type: "SET_CONFIG", config });
        }
        dispatch({
          type: "SET_SETUP_STATUS",
          needsSetup: needsSetup(configExists, aiConfigured),
          aiApiKeyConfigured: aiConfigured,
          lineCredentialsConfigured: lineConfigured,
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            toJapaneseError(err, "設定の読み込みに失敗しました。"),
          );
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [dispatch, setError]);

  // --- 生成フロー ---

  /** 生成進捗ストリーム（image:generate:progress）を購読し、画像・進捗を更新する（要件 2.5, 2.6） */
  const subscribeGenerateProgress = useCallback(
    (totalCount: number): (() => void) | undefined => {
      const api = typeof window !== "undefined" ? window.api : undefined;
      if (!api?.onGenerateProgress) {
        return undefined;
      }
      const handler = (payload: GenerationStreamPayload): void => {
        if (payload.event === "error") {
          dispatch({
            type: "GENERATION_FAILED",
            message: payload.data.message ?? "画像の生成に失敗しました。",
          });
          return;
        }
        if (payload.event === "done") {
          dispatch({ type: "GENERATION_COMPLETE" });
          return;
        }
        if (payload.event === "progress") {
          const data = payload.data;
          const hasError = data.error != null;
          dispatch({
            type: "UPSERT_GENERATED_IMAGE",
            image: {
              index: data.index,
              dataUrl: data.dataUrl ?? "",
              tempFilePath: data.latestImagePath ?? "",
              status: hasError ? "error" : "done",
              ...(hasError && data.error?.message
                ? { errorMessage: data.error.message }
                : {}),
            },
          });
        }
      };
      const unsubscribe = api.onGenerateProgress(handler);
      // totalCount は将来的な進捗率算出用に保持（現状は ImagePreviewGrid へ props で渡す）
      void totalCount;
      return typeof unsubscribe === "function" ? unsubscribe : undefined;
    },
    [dispatch],
  );

  const handleGenerate = useCallback(
    (request: GenerationRequest): void => {
      // プロンプト履歴へ保存（要件 1.7）
      addHistory(request.prompt);
      dispatch({ type: "START_GENERATION", request });

      // 進捗購読を開始してから生成をリクエストする
      subscribeGenerateProgress(request.count);

      const call = withApi((api) =>
        api.image?.generate
          ? api.image.generate(request)
          : Promise.reject(new Error("生成 API を利用できません。")),
      );
      if (call) {
        call.catch((err) => {
          dispatch({
            type: "GENERATION_FAILED",
            message: toJapaneseError(err, "画像の生成に失敗しました。"),
          });
        });
      }
    },
    [addHistory, dispatch, subscribeGenerateProgress],
  );

  const handleHistorySelect = useCallback(
    (_prompt: string): void => {
      // 履歴選択は PromptInput 内のフォームへ反映される（要件 1.8）。
      // ここでは追加の副作用は行わない。
    },
    [],
  );

  const handleRetryGeneration = useCallback((): void => {
    if (state.currentRequest) {
      handleGenerate(state.currentRequest);
    }
  }, [handleGenerate, state.currentRequest]);

  const handleDeleteImage = useCallback(
    (index: number): void => {
      dispatch({ type: "DELETE_GENERATED_IMAGE", index });
    },
    [dispatch],
  );

  const handleRegenerateImage = useCallback(
    (index: number): void => {
      // 個別再生成: 元の Prompt・スタイルで 1 枚を再生成する（要件 2.9）
      if (!state.currentRequest) {
        return;
      }
      dispatch({
        type: "UPSERT_GENERATED_IMAGE",
        image: {
          index,
          dataUrl: "",
          tempFilePath: "",
          status: "generating",
        },
      });
      const call = withApi((api) =>
        api.image?.generate
          ? api.image.generate({ ...state.currentRequest!, count: 8 })
          : undefined,
      );
      call?.catch((err) => {
        setError(toJapaneseError(err, "画像の再生成に失敗しました。"));
      });
    },
    [dispatch, setError, state.currentRequest],
  );

  const handleApproveStyle = useCallback(
    (remainingCount: number): void => {
      // プレビュー承認モード: 残り n-1 枚を生成する（要件 2.3）
      if (!state.currentRequest) {
        return;
      }
      const call = withApi((api) =>
        api.image?.generate
          ? api.image.generate({
              ...state.currentRequest!,
              count: remainingCount as GenerationRequest["count"],
              mode: "batch",
            })
          : undefined,
      );
      call?.catch((err) => {
        setError(toJapaneseError(err, "残りの画像の生成に失敗しました。"));
      });
    },
    [setError, state.currentRequest],
  );

  const handleRedo = useCallback((): void => {
    // 承認モードでやり直し: 生成済み 1 枚を破棄して再生成する（要件 2.4）
    if (state.currentRequest) {
      handleGenerate(state.currentRequest);
    }
  }, [handleGenerate, state.currentRequest]);

  // --- StampSet 編集 ---

  const handleBuildStampSet = useCallback(async (): Promise<void> => {
    const api = typeof window !== "undefined" ? window.api : undefined;
    if (!api?.image?.process) {
      setError("画像変換APIを利用できません。");
      return;
    }
    if (state.generatedImages.length === 0) {
      setError("変換できる生成画像がありません。");
      return;
    }

    dispatch({ type: "START_STAMP_SET_PROCESSING" });
    const result = await buildStampSetFromGeneratedImages(
      state.generatedImages,
      (sourcePath) => api.image.process(sourcePath),
    );
    dispatch({ type: "SET_STAMP_SET", stampSet: result.stampSet });
    if (result.failedCount > 0) {
      setError(
        `${result.failedCount}枚の画像を変換できませんでした。編集画面から再試行または差し替えを行ってください。`,
      );
    }
  }, [dispatch, setError, state.generatedImages]);

  const handleTitleChange = useCallback(
    (title: string): void => {
      dispatch({ type: "UPDATE_STAMP_SET_TITLE", title });
    },
    [dispatch],
  );

  const handleDescriptionChange = useCallback(
    (description: string): void => {
      dispatch({ type: "UPDATE_STAMP_SET_DESCRIPTION", description });
    },
    [dispatch],
  );

  const handleCreatorNameChange = useCallback(
    (creatorName: string): void => {
      dispatch({ type: "UPDATE_STAMP_SET_CREATOR_NAME", creatorName });
    },
    [dispatch],
  );

  const handleCopyrightChange = useCallback(
    (copyright: string): void => {
      dispatch({ type: "UPDATE_STAMP_SET_COPYRIGHT", copyright });
    },
    [dispatch],
  );

  const processStampImageAt = useCallback(
    async (index: number, sourcePath: string, fallbackPreviewUrl = ""): Promise<void> => {
      const api = typeof window !== "undefined" ? window.api : undefined;
      if (!api?.image?.process) {
        setError("画像変換APIを利用できません。");
        return;
      }

      dispatch({ type: "START_STAMP_IMAGE_PROCESSING", index, sourcePath });
      try {
        const processed = await api.image.process(sourcePath);
        dispatch({
          type: "UPDATE_STAMP_IMAGE",
          index,
          image: toStampImage(sourcePath, processed, fallbackPreviewUrl),
        });
        setError(null);
      } catch (err) {
        const message = toJapaneseError(
          err,
          `画像 ${index + 1} の変換に失敗しました。`,
        );
        dispatch({ type: "STAMP_IMAGE_PROCESS_FAILED", index, message });
        setError(message);
      }
    },
    [dispatch, setError],
  );

  const handleReplaceImage = useCallback(
    (index: number, file: File): void => {
      const sourcePath = (file as File & { path?: string }).path;
      if (!sourcePath) {
        setError("差し替え画像のパスを取得できませんでした。");
        return;
      }
      void processStampImageAt(index, sourcePath);
    },
    [processStampImageAt, setError],
  );

  const handleRetryImage = useCallback(
    (index: number): void => {
      const image = state.stampSet?.images[index];
      if (!image?.sourcePath) {
        setError("再試行する元画像のパスがありません。画像を差し替えてください。");
        return;
      }
      void processStampImageAt(index, image.sourcePath, image.stampPreviewUrl);
    },
    [processStampImageAt, setError, state.stampSet],
  );

  const handleExport = useCallback(async (): Promise<void> => {
    const stampSet = state.stampSet;
    const api = typeof window !== "undefined" ? window.api : undefined;
    if (!stampSet || !api?.archive?.create) {
      setError("ZIPエクスポートAPIを利用できません。");
      return;
    }

    setIsExporting(true);
    setExportMessage(null);
    setError(null);
    try {
      const result = await api.archive.create(
        toExportCreateRequest(
          stampSet,
          state.config?.outputDirectory ?? "",
        ),
      );
      if (result) {
        setExportMessage(
          `${result.fileName} を保存しました（スタンプ画像 ${result.imageCount}枚）。`,
        );
      }
    } catch (err) {
      setError(toJapaneseError(err, "ZIPエクスポートに失敗しました。"));
    } finally {
      setIsExporting(false);
    }
  }, [setError, state.config?.outputDirectory, state.stampSet]);

  const handleStartUpload = useCallback((): void => {
    if (!LINE_CREATORS_UPLOAD_ENABLED) {
      setError("LINE Creators Marketへの自動アップロード機能は現在保留中です。");
      return;
    }
    if (!state.stampSet) {
      return;
    }
    const stampSet = state.stampSet;
    // 認証情報未設定時はアップロードを開始しない（要件 5.8）
    if (!state.lineCredentialsConfigured) {
      setError(
        "LINE Creators Market の認証情報が設定されていません。設定画面から登録してください。",
      );
      return;
    }
    dispatch({ type: "START_UPLOAD" });

    // アップロード進捗ストリームを購読する（要件 5.2）
    const api = typeof window !== "undefined" ? window.api : undefined;
    if (api?.onUploadProgress) {
      api.onUploadProgress((payload: UploadStreamPayload) => {
        if (payload.event === "error") {
          dispatch({
            type: "SET_UPLOAD_RESULT",
            result: toUploadErrorResult(payload.data),
          });
          return;
        }
        if (payload.event === "done") {
          dispatch({
            type: "SET_UPLOAD_RESULT",
            result: toUploadResult(payload.data),
          });
          return;
        }
        if (payload.event === "progress") {
          dispatch({
            type: "SET_UPLOAD_PROGRESS",
            progress: payload.data,
          });
        }
      });
    }

    const call = withApi((apiRef) =>
      apiRef.upload?.start
        ? apiRef.upload.start(toUploadStartRequest(stampSet))
        : undefined,
    );
    call?.catch((err) => {
      dispatch({
        type: "SET_UPLOAD_RESULT",
        result: {
          success: false,
          errorType: "unknown",
          retryCount: 0,
          errorMessage: toJapaneseError(err, "アップロードに失敗しました。"),
        },
      });
    });
  }, [dispatch, setError, state.lineCredentialsConfigured, state.stampSet]);

  // --- 設定（ConfigPanel / SetupWizard） ---

  const saveConfig = useCallback(
    async (config: Config): Promise<void> => {
      const call = withApi((api) =>
        api.config?.save ? api.config.save(config) : undefined,
      );
      if (call) {
        await call;
      }
      dispatch({ type: "SET_CONFIG", config });
    },
    [dispatch],
  );

  const saveCredential = useCallback(
    async (key: string, value: string): Promise<void> => {
      // 認証情報は window.api → キーチェーンへのみ渡す（tech.md セキュリティルール）。
      const call = withApi((api) =>
        api.credential?.save ? api.credential.save(key, value) : undefined,
      );
      if (call) {
        await call;
      }
      if (key === CREDENTIAL_KEYS.aiApiKey) {
        dispatch({ type: "SET_AI_API_KEY_CONFIGURED", configured: true });
      } else if (
        key === CREDENTIAL_KEYS.lineEmail ||
        key === CREDENTIAL_KEYS.linePassword
      ) {
        const api = typeof window !== "undefined" ? window.api : undefined;
        const [emailStatus, passwordStatus] = await Promise.all([
          api?.credential?.get?.(CREDENTIAL_KEYS.lineEmail),
          api?.credential?.get?.(CREDENTIAL_KEYS.linePassword),
        ]);
        dispatch({
          type: "SET_LINE_CREDENTIALS_CONFIGURED",
          configured:
            isCredentialConfigured(emailStatus) &&
            isCredentialConfigured(passwordStatus),
        });
      }
    },
    [dispatch],
  );

  const exportConfig = useCallback(async (): Promise<Config> => {
    const call = withApi((api) =>
      api.config?.export ? api.config.export() : undefined,
    );
    const result = call ? await call : undefined;
    if (!result) {
      throw new Error("設定のエクスポートAPIを利用できません。");
    }
    return result;
  }, []);

  const importConfig = useCallback(
    async (data: Config): Promise<void> => {
      const call = withApi((api) =>
        api.config?.import ? api.config.import(data) : undefined,
      );
      if (call) {
        await call;
      }
      dispatch({ type: "SET_CONFIG", config: data });
    },
    [dispatch],
  );

  // SetupWizard 用: Config 保存（Config のみ）
  const handleSetupSaveConfig = useCallback(
    (config: Config): Promise<void> => saveConfig(config),
    [saveConfig],
  );

  // SetupWizard 用: APIキー保存（キーチェーン）
  const handleSetupSaveCredential = useCallback(
    (apiKey: string): Promise<void> =>
      saveCredential(CREDENTIAL_KEYS.aiApiKey, apiKey),
    [saveCredential],
  );

  const handleSetupComplete = useCallback((): void => {
    dispatch({ type: "COMPLETE_SETUP" });
    dispatch({ type: "GO_TO_STEP", step: "prompt" });
  }, [dispatch]);

  // --- ログ（LogViewer） ---
  const [logs, setLogs] = React.useState<LogEntry[]>([]);

  const fetchLogs = useCallback(
    (filter?: LogFilter): void => {
      const params: {
        level?: string;
        dateFrom?: string;
        dateTo?: string;
        limit?: number;
      } = { limit: 1000 };
      if (filter) {
        if (filter.level !== "all") {
          params.level = filter.level;
        }
        if (filter.dateFrom) {
          params.dateFrom = filter.dateFrom;
        }
        if (filter.dateTo) {
          params.dateTo = filter.dateTo;
        }
      }
      const call = withApi((api) =>
        api.logs?.get ? api.logs.get(params) : undefined,
      );
      call
        ?.then((entries) => {
          if (entries) {
            setLogs(entries);
          }
        })
        .catch((err) => {
          setError(toJapaneseError(err, "ログの取得に失敗しました。"));
        });
    },
    [setError],
  );

  // ログパネルを開いたときに一度取得する
  useEffect(() => {
    if (state.panel === "logs") {
      fetchLogs();
    }
  }, [state.panel, fetchLogs]);

  // --- レンダリング ---

  const totalCount = state.currentRequest?.count ?? 0;

  return (
    <div className="app">
      {/* ヘッダ・ナビゲーション（アクセシブルな画面切り替え） */}
      <header className="app__header">
        <h1 className="app__title">LINEスタンプジェネレーター</h1>
        <nav className="app__nav" aria-label="画面切り替え">
          <button
            type="button"
            onClick={() => dispatch({ type: "GO_TO_STEP", step: "prompt" })}
            aria-current={state.step === "prompt" ? "page" : undefined}
          >
            スタンプを作る
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "OPEN_PANEL", panel: "config" })}
            aria-current={state.panel === "config" ? "page" : undefined}
          >
            設定
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "OPEN_PANEL", panel: "logs" })}
            aria-current={state.panel === "logs" ? "page" : undefined}
          >
            ログ
          </button>
        </nav>
      </header>

      {/* エラーメッセージ（日本語、要件 7.1 のエラー通知方針） */}
      {state.error && (
        <div className="app__error-banner" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={() => setError(null)}>
            閉じる
          </button>
        </div>
      )}

      {/* 初回セットアップウィザード（要件 6.3、needsSetup のとき表示） */}
      <SetupWizard
        visible={state.needsSetup}
        onSaveConfig={handleSetupSaveConfig}
        onSaveCredential={handleSetupSaveCredential}
        onComplete={handleSetupComplete}
      />

      {/* 補助パネル: 設定 */}
      {state.panel === "config" && (
        <div className="app__panel" role="region" aria-label="設定パネル">
          <button
            type="button"
            className="app__panel-close"
            onClick={() => dispatch({ type: "CLOSE_PANEL" })}
          >
            閉じる
          </button>
          <ConfigPanel
            config={state.config}
            aiApiKeyConfigured={state.aiApiKeyConfigured}
            lineCredentialsConfigured={state.lineCredentialsConfigured}
            lineUploadEnabled={LINE_CREATORS_UPLOAD_ENABLED}
            onSaveConfig={saveConfig}
            onSaveCredential={saveCredential}
            onExportConfig={exportConfig}
            onImportConfig={importConfig}
          />
        </div>
      )}

      {/* 補助パネル: ログ */}
      {state.panel === "logs" && (
        <div className="app__panel" role="region" aria-label="ログパネル">
          <button
            type="button"
            className="app__panel-close"
            onClick={() => dispatch({ type: "CLOSE_PANEL" })}
          >
            閉じる
          </button>
          <LogViewer entries={logs} onFilterChange={fetchLogs} />
        </div>
      )}

      {/* メイン生成フロー（補助パネルが開いていないときに表示） */}
      {state.panel === null && (
        <main className="app__main">
          {/* 1. プロンプト入力（要件 1） */}
          {state.step === "prompt" && (
            <PromptInput
              onSubmit={handleGenerate}
              history={history}
              onHistorySelect={handleHistorySelect}
            />
          )}

          {/* 2. 生成中／プレビュー（要件 2） */}
          {(state.step === "generating" || state.step === "preview") && (
            <>
              <ImagePreviewGrid
                images={state.generatedImages}
                mode={state.currentRequest?.mode ?? "batch"}
                totalCount={totalCount}
                onDelete={handleDeleteImage}
                onRegenerate={handleRegenerateImage}
                onApproveStyle={handleApproveStyle}
                onRedo={handleRedo}
                onRetryGeneration={handleRetryGeneration}
                hasError={state.generationFailed}
                {...(state.error ? { errorMessage: state.error } : {})}
              />
              {state.step === "preview" &&
                !state.generationFailed &&
                state.stampSet === null && (
                  <div className="app__flow-actions">
                    <p>
                      画像の確認が終わったら、スタンプセットの編集へ進みます。
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleBuildStampSet()}
                      disabled={state.generatedImages.length === 0}
                    >
                      スタンプセットを編集する
                    </button>
                  </div>
                )}
            </>
          )}

          {state.step === "processing" && (
            <section className="app__processing" aria-live="polite" role="status">
              <h2>LINE規格へ変換しています</h2>
              <p>スタンプ・メイン・サムネイル画像を順番に作成しています…</p>
            </section>
          )}

          {/* 3. スタンプセット編集（要件 3, 4） */}
          {state.step === "edit" && state.stampSet && (
            <StampSetEditor
              stampSet={state.stampSet}
              onTitleChange={handleTitleChange}
              onDescriptionChange={handleDescriptionChange}
              onCreatorNameChange={handleCreatorNameChange}
              onCopyrightChange={handleCopyrightChange}
              onReplaceImage={handleReplaceImage}
              onRetryImage={handleRetryImage}
              onExport={handleExport}
              isExporting={isExporting}
              exportMessage={exportMessage}
              onUpload={handleStartUpload}
              lineUploadEnabled={LINE_CREATORS_UPLOAD_ENABLED}
            />
          )}

          {/* 4. アップロード（要件 5） */}
          {LINE_CREATORS_UPLOAD_ENABLED && state.step === "upload" && (
            <UploadPanel
              isValidForUpload={state.stampSet?.isValidForUpload ?? false}
              credentialsConfigured={state.lineCredentialsConfigured}
              progress={state.uploadProgress}
              result={state.uploadResult}
              onUpload={handleStartUpload}
            />
          )}
        </main>
      )}
    </div>
  );

};

/** クレデンシャル取得結果が「設定済み」を意味するか判定する。 */
function isCredentialConfigured(result: unknown): boolean {
  if (result == null) {
    return false;
  }
  if (typeof result === "string") {
    return result.length > 0;
  }
  if (typeof result === "object") {
    const obj = result as { configured?: unknown };
    return obj.configured === true;
  }
  return false;
}

/**
 * ルートコンポーネント。グローバル状態プロバイダで内部コンポーネントをラップする。
 */
const App: React.FC = () => (
  <AppStoreProvider>
    <AppInner />
  </AppStoreProvider>
);

export default App;
