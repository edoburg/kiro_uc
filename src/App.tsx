import React, { useCallback, useEffect } from "react";
import type {
  Config,
  GenerationRequest,
} from "./types/index";
import type { StreamPushPayload } from "./types/window-api";

import PromptInput from "./components/PromptInput";
import ImagePreviewGrid from "./components/ImagePreviewGrid";
import StampSetEditor from "./components/StampSetEditor";
import UploadPanel from "./components/UploadPanel";
import ConfigPanel from "./components/ConfigPanel";
import SetupWizard, { needsSetup } from "./components/SetupWizard";
import LogViewer from "./components/LogViewer";
import type { LogFilter } from "./components/LogViewer";
import type { UploadProgress } from "./components/UploadPanel";

import { usePromptHistoryStore } from "./stores/promptHistoryStore";
import { CREDENTIAL_KEYS } from "./components/ConfigPanel";
import {
  AppStoreProvider,
  useAppStore,
} from "./stores/appStore";
import type { LogEntry } from "./types/index";

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

        if (cancelled) {
          return;
        }

        const aiConfigured = isCredentialConfigured(aiKey);
        const lineConfigured = isCredentialConfigured(lineEmail);
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
      const handler = (payload: StreamPushPayload): void => {
        if (payload.event === "error") {
          const data = payload.data as { message?: string } | undefined;
          dispatch({
            type: "GENERATION_FAILED",
            message: data?.message ?? "画像の生成に失敗しました。",
          });
          return;
        }
        if (payload.event === "done") {
          dispatch({ type: "GENERATION_COMPLETE" });
          return;
        }
        // progress: 完了画像を反映する
        const data = payload.data as
          | {
              index?: number;
              dataUrl?: string;
              tempFilePath?: string;
              status?: "pending" | "generating" | "done" | "error";
              errorMessage?: string;
            }
          | undefined;
        if (data && typeof data.index === "number") {
          dispatch({
            type: "UPSERT_GENERATED_IMAGE",
            image: {
              index: data.index,
              dataUrl: data.dataUrl ?? "",
              tempFilePath: data.tempFilePath ?? "",
              status: data.status ?? "done",
              ...(data.errorMessage
                ? { errorMessage: data.errorMessage }
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

  const handleReplaceImage = useCallback(
    (index: number, file: File): void => {
      // 差し替えは IPC 経由で画像処理を行う（要件 3.4, 3.7）。
      // File 由来のパスは Electron 環境でのみ利用可能。
      const sourcePath = (file as File & { path?: string }).path;
      if (!sourcePath) {
        setError("差し替え画像のパスを取得できませんでした。");
        return;
      }
      const call = withApi((api) =>
        api.image?.process ? api.image.process(sourcePath) : undefined,
      );
      call?.catch((err) => {
        setError(
          toJapaneseError(
            err,
            `画像 ${index + 1} の差し替え処理に失敗しました。`,
          ),
        );
      });
    },
    [setError],
  );

  const handleExport = useCallback(
    (_outputPath: string): void => {
      // エクスポート（ZIP 化）はバックエンド側で実施される想定。
      // 失敗時は日本語メッセージを表示する（要件 3.4 のエラー方針）。
      setError(null);
    },
    [setError],
  );

  const handleStartUpload = useCallback((): void => {
    if (!state.stampSet) {
      return;
    }
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
      api.onUploadProgress((payload: StreamPushPayload) => {
        if (payload.event === "error") {
          const data = payload.data as { message?: string } | undefined;
          dispatch({
            type: "SET_UPLOAD_RESULT",
            result: {
              success: false,
              errorType: "unknown",
              retryCount: 0,
              errorMessage:
                data?.message ?? "アップロードに失敗しました。",
            },
          });
          return;
        }
        if (payload.event === "done") {
          const data = payload.data as
            | { applicationId?: string; status?: string }
            | undefined;
          dispatch({
            type: "SET_UPLOAD_RESULT",
            result: {
              success: true,
              retryCount: 0,
              ...(data?.applicationId
                ? { applicationId: data.applicationId }
                : {}),
              ...(data?.status ? { status: data.status } : {}),
            },
          });
          return;
        }
        const progress = payload.data as UploadProgress | undefined;
        if (progress) {
          dispatch({ type: "SET_UPLOAD_PROGRESS", progress });
        }
      });
    }

    const call = withApi((apiRef) =>
      apiRef.upload?.start
        ? apiRef.upload.start(state.stampSet)
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
        dispatch({
          type: "SET_LINE_CREDENTIALS_CONFIGURED",
          configured: true,
        });
      }
    },
    [dispatch],
  );

  const exportConfig = useCallback(async (): Promise<
    Record<string, unknown>
  > => {
    const call = withApi((api) =>
      api.config?.export ? api.config.export() : undefined,
    );
    const result = call ? await call : undefined;
    return result ?? {};
  }, []);

  const importConfig = useCallback(
    async (data: Record<string, unknown>): Promise<void> => {
      const call = withApi((api) =>
        api.config?.import ? api.config.import(data) : undefined,
      );
      if (call) {
        await call;
      }
      // インポート結果を Config として反映する（認証情報は含まれない）
      dispatch({
        type: "SET_CONFIG",
        config: {
          aiEngine: data.aiEngine as Config["aiEngine"],
          outputDirectory: data.outputDirectory as string,
          dalleModel: data.dalleModel as string,
          sdEndpoint: data.sdEndpoint as string,
        },
      });
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
                      onClick={() =>
                        dispatch({
                          type: "SET_STAMP_SET",
                          stampSet: buildStampSetFromImages(),
                        })
                      }
                      disabled={state.generatedImages.length === 0}
                    >
                      スタンプセットを編集する
                    </button>
                  </div>
                )}
            </>
          )}

          {/* 3. スタンプセット編集（要件 3, 4） */}
          {state.step === "edit" && state.stampSet && (
            <StampSetEditor
              stampSet={state.stampSet}
              onTitleChange={handleTitleChange}
              onDescriptionChange={handleDescriptionChange}
              onReplaceImage={handleReplaceImage}
              onExport={handleExport}
              onUpload={handleStartUpload}
            />
          )}

          {/* 4. アップロード（要件 5） */}
          {state.step === "upload" && (
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

  /**
   * プレビュー画像から編集用 StampSet の初期値を組み立てる。
   * 実際の LINE 規格変換結果はバックエンド（image:process）由来だが、
   * ここでは編集画面へ遷移するための最小の StampSet を用意する。
   */
  function buildStampSetFromImages() {
    return {
      title: "",
      description: "",
      images: state.generatedImages.map((img) => ({
        stampPath: img.dataUrl,
        mainImagePath: img.dataUrl,
        thumbnailPath: img.dataUrl,
        validationResult: {
          passed: false,
          sizeOk: false,
          formatOk: false,
          fileSizeOk: false,
          fileSizeExceeded: false,
          details: "変換前",
        },
      })),
      isValidForUpload: false,
    };
  }
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
