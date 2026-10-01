import React, { useCallback, useEffect } from "react";
import type {
  Config,
  GeneratedImage,
  GenerationRequest,
  GenerationStartRequest,
} from "./types/index";
import type {
  GenerationStreamPayload,
  UploadStreamPayload,
} from "./types/window-api";

import PromptInput from "./components/PromptInput";
import StampPlanEditor from "./components/StampPlanEditor";
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
import {
  classifyGenerationOutcome,
  toGenerationStartRequest,
} from "./utils/generationFlow";
import { validateStampPlan } from "./utils/stampPlan";

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
  const [isGenerationActive, setIsGenerationActive] = React.useState(false);
  const [approvalGranted, setApprovalGranted] = React.useState(false);
  const generationUnsubscribeRef = React.useRef<(() => void) | null>(null);
  const activeGenerationStreamIdRef = React.useRef<string | null>(null);
  const pendingGenerationEventsRef = React.useRef<GenerationStreamPayload[]>([]);
  const generationInFlightRef = React.useRef(false);
  const confirmedRequestRef = React.useRef<GenerationRequest | null>(null);
  const generationRunRef = React.useRef<{
    requiredSucceeded: number;
    baselineSucceeded: number;
    preserveOnFailure?: GeneratedImage;
  } | null>(null);
  const uploadUnsubscribeRef = React.useRef<(() => void) | null>(null);
  const activeUploadStreamIdRef = React.useRef<string | null>(null);
  const pendingUploadEventsRef = React.useRef<UploadStreamPayload[]>([]);
  const uploadInFlightRef = React.useRef(false);

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

  const cleanupGenerationStream = useCallback((updateState = true): void => {
    generationUnsubscribeRef.current?.();
    generationUnsubscribeRef.current = null;
    activeGenerationStreamIdRef.current = null;
    pendingGenerationEventsRef.current = [];
    generationRunRef.current = null;
    generationInFlightRef.current = false;
    if (updateState) {
      setIsGenerationActive(false);
    }
  }, []);

  const cleanupUploadStream = useCallback((): void => {
    uploadUnsubscribeRef.current?.();
    uploadUnsubscribeRef.current = null;
    activeUploadStreamIdRef.current = null;
    pendingUploadEventsRef.current = [];
    uploadInFlightRef.current = false;
  }, []);

  useEffect(
    () => () => {
      cleanupGenerationStream(false);
      cleanupUploadStream();
    },
    [cleanupGenerationStream, cleanupUploadStream],
  );

  /** 現在の streamId に属する生成イベントだけを状態へ反映する。 */
  const processGenerationPayload = useCallback(
    (payload: GenerationStreamPayload): void => {
      if (payload.streamId !== activeGenerationStreamIdRef.current) {
        return;
      }

      const run = generationRunRef.current;
      if (payload.event === "progress") {
        const data = payload.data;
        const hasError = data.error != null;
        if (hasError && run?.preserveOnFailure?.index === data.index) {
          return;
        }
        dispatch({
          type: "UPSERT_GENERATED_IMAGE",
          image: {
            index: data.index,
            itemId: confirmedRequestRef.current?.items?.[data.index]?.id,
            dataUrl: data.dataUrl ?? "",
            tempFilePath: data.latestImagePath ?? "",
            status: hasError ? "error" : "done",
            ...(hasError && data.error?.message
              ? { errorMessage: data.error.message }
              : {}),
          },
        });
        return;
      }

      if (payload.event === "error") {
        const message = payload.data.message ?? "画像の生成に失敗しました。";
        dispatch({
          type: (run?.baselineSucceeded ?? 0) > 0
            ? "GENERATION_PARTIAL"
            : "GENERATION_FAILED",
          message,
        });
        cleanupGenerationStream();
        return;
      }

      if (payload.event === "done") {
        const outcome = classifyGenerationOutcome(
          payload.data,
          run?.baselineSucceeded ?? 0,
          run?.requiredSucceeded ?? payload.data.total,
        );
        if (outcome === "failed") {
          dispatch({
            type: "GENERATION_FAILED",
            message: "すべての画像生成に失敗しました。もう一度お試しください。",
          });
        } else if (outcome === "partial") {
          dispatch({
            type: "GENERATION_PARTIAL",
            message: "一部の画像を生成できませんでした。失敗した画像だけ再試行してください。",
          });
        } else {
          dispatch({ type: "GENERATION_COMPLETE" });
        }
        cleanupGenerationStream();
      }
    },
    [cleanupGenerationStream, dispatch],
  );

  /** 購読を先に開始し、返却された streamId と一致するイベントだけを処理する。 */
  const startGeneration = useCallback(
    async (
      request: GenerationStartRequest,
      requiredSucceeded: number,
      baselineSucceeded: number,
      preserveOnFailure?: GeneratedImage,
    ): Promise<void> => {
      if (generationInFlightRef.current) {
        return;
      }

      cleanupGenerationStream();
      generationInFlightRef.current = true;
      setIsGenerationActive(true);
      generationRunRef.current = { requiredSucceeded, baselineSucceeded, preserveOnFailure };

      const api = typeof window !== "undefined" ? window.api : undefined;
      if (!api?.image?.generate || !api.onGenerateProgress) {
        dispatch({
          type:
            baselineSucceeded > 0
              ? "GENERATION_PARTIAL"
              : "GENERATION_FAILED",
          message: "生成 API を利用できません。",
        });
        cleanupGenerationStream();
        return;
      }

      generationUnsubscribeRef.current = api.onGenerateProgress((payload) => {
        if (activeGenerationStreamIdRef.current === null) {
          pendingGenerationEventsRef.current.push(payload);
          return;
        }
        processGenerationPayload(payload);
      });

      try {
        const handle = await api.image.generate(request);
        activeGenerationStreamIdRef.current = handle.streamId;
        const pending = pendingGenerationEventsRef.current;
        pendingGenerationEventsRef.current = [];
        pending.forEach(processGenerationPayload);
      } catch (err) {
        dispatch({
          type:
            baselineSucceeded > 0
              ? "GENERATION_PARTIAL"
              : "GENERATION_FAILED",
          message: toJapaneseError(err, "画像の生成に失敗しました。"),
        });
        cleanupGenerationStream();
      }
    },
    [cleanupGenerationStream, dispatch, processGenerationPayload],
  );

  const handleGenerate = useCallback(
    (request: GenerationRequest): void => {
      if (generationInFlightRef.current) {
        return;
      }
      const errors = validateStampPlan(request);
      if (errors.length > 0) {
        setError(errors[0]);
        return;
      }
      confirmedRequestRef.current = request;
      setApprovalGranted(false);
      // プロンプト履歴へ保存（要件 1.7）
      addHistory(request.prompt);
      dispatch({ type: "START_GENERATION", request });
      const count = request.mode === "preview_approval" ? 1 : request.count;
      void startGeneration(
        toGenerationStartRequest(request, state.config, { count, startIndex: 0 }),
        count,
        0,
      );
    },
    [addHistory, dispatch, setError, startGeneration, state.config],
  );

  const handleCreatePlan = useCallback((request: GenerationRequest): void => {
    if (generationInFlightRef.current) return;
    dispatch({ type: "SET_DRAFT_REQUEST", request });
  }, [dispatch]);

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
      // 個別再生成: 確定した企画から対象位置の設定を使用する。
      if (!state.currentRequest || generationInFlightRef.current) {
        return;
      }
      if (!state.currentRequest.items?.[index]) return;
      const baselineSucceeded = state.generatedImages.filter(
        (image) => image.index !== index && image.status === "done",
      ).length;
      const previousImage = state.generatedImages.find((image) => image.index === index && image.status === "done");
      const isApprovalPreviewOnly =
        state.currentRequest.mode === "preview_approval" &&
        state.generatedImages.every((image) => image.index === 0);
      if (!previousImage) {
        dispatch({
          type: "UPSERT_GENERATED_IMAGE",
          image: {
            index,
            itemId: state.currentRequest.items[index].id,
            dataUrl: "",
            tempFilePath: "",
            status: "generating",
          },
        });
      }
      void startGeneration(
        toGenerationStartRequest(state.currentRequest, state.config, {
          count: 1,
          startIndex: index,
          mode: "batch",
        }),
        isApprovalPreviewOnly ? 1 : state.currentRequest.count,
        baselineSucceeded,
        previousImage,
      );
    },
    [
      dispatch,
      startGeneration,
      state.config,
      state.currentRequest,
      state.generatedImages,
    ],
  );

  const handleApproveStyle = useCallback(
    (remainingCount: number): void => {
      // プレビュー承認モード: 残り n-1 枚を生成する（要件 2.3）
      if (
        !state.currentRequest ||
        generationInFlightRef.current ||
        remainingCount <= 0
      ) {
        return;
      }
      const baselineSucceeded = state.generatedImages.filter(
        (image) => image.status === "done",
      ).length;
      setApprovalGranted(true);
      void startGeneration(
        toGenerationStartRequest(state.currentRequest, state.config, {
          count: remainingCount,
          startIndex: 1,
          mode: "batch",
        }),
        state.currentRequest.count,
        baselineSucceeded,
      );
    },
    [startGeneration, state.config, state.currentRequest, state.generatedImages],
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
    if (
      state.generatedImages.length !== state.currentRequest?.count ||
      state.generatedImages.some((image) => image.status !== "done")
    ) {
      setError("未完了または生成に失敗した画像があります。再試行してから進んでください。");
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
  }, [
    dispatch,
    setError,
    state.currentRequest?.count,
    state.generatedImages,
  ]);

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
    if (!state.stampSet || uploadInFlightRef.current) {
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

    const api = typeof window !== "undefined" ? window.api : undefined;
    if (!api?.onUploadProgress || !api.upload?.start) {
      dispatch({
        type: "SET_UPLOAD_RESULT",
        result: {
          success: false,
          errorType: "unknown",
          retryCount: 0,
          errorMessage: "アップロード API を利用できません。",
        },
      });
      return;
    }

    cleanupUploadStream();
    uploadInFlightRef.current = true;
    const processPayload = (payload: UploadStreamPayload): void => {
      if (payload.streamId !== activeUploadStreamIdRef.current) {
        return;
      }
      if (payload.event === "error") {
        dispatch({
          type: "SET_UPLOAD_RESULT",
          result: toUploadErrorResult(payload.data),
        });
        cleanupUploadStream();
        return;
      }
      if (payload.event === "done") {
        dispatch({
          type: "SET_UPLOAD_RESULT",
          result: toUploadResult(payload.data),
        });
        cleanupUploadStream();
        return;
      }
      if (payload.event === "progress") {
        dispatch({
          type: "SET_UPLOAD_PROGRESS",
          progress: payload.data,
        });
      }
    };

    uploadUnsubscribeRef.current = api.onUploadProgress((payload) => {
      if (activeUploadStreamIdRef.current === null) {
        pendingUploadEventsRef.current.push(payload);
        return;
      }
      processPayload(payload);
    });

    void api.upload.start(toUploadStartRequest(stampSet)).then(
      (handle) => {
        activeUploadStreamIdRef.current = handle.streamId;
        const pending = pendingUploadEventsRef.current;
        pendingUploadEventsRef.current = [];
        pending.forEach(processPayload);
      },
      (err) => {
        dispatch({
          type: "SET_UPLOAD_RESULT",
          result: {
            success: false,
            errorType: "unknown",
            retryCount: 0,
            errorMessage: toJapaneseError(err, "アップロードに失敗しました。"),
          },
        });
        cleanupUploadStream();
      },
    );
  }, [
    cleanupUploadStream,
    dispatch,
    setError,
    state.lineCredentialsConfigured,
    state.stampSet,
  ]);

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
  const canBuildStampSet =
    !isGenerationActive &&
    totalCount > 0 &&
    state.generatedImages.length === totalCount &&
    state.generatedImages.every((image) => image.status === "done");

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
          {/* 1. 共通設定 */}
          {state.step === "prompt" && (
            <PromptInput
              onSubmit={handleCreatePlan}
              history={history}
              initialRequest={state.draftRequest}
            />
          )}

          {state.step === "plan" && state.draftRequest && (
            <StampPlanEditor
              key={`${state.draftRequest.theme}-${state.draftRequest.count}-${state.draftRequest.prompt}`}
              request={state.draftRequest}
              onItemsChange={(items) => dispatch({ type: "SET_DRAFT_REQUEST", request: { ...state.draftRequest!, items } })}
              onBack={() => dispatch({ type: "GO_TO_STEP", step: "prompt" })}
              onGenerate={handleGenerate}
            />
          )}

          {/* 2. 生成中／プレビュー（要件 2） */}
          {(state.step === "generating" || state.step === "preview") && (
            <>
              <ImagePreviewGrid
                images={state.generatedImages}
                items={state.currentRequest?.items}
                mode={state.currentRequest?.mode ?? "batch"}
                totalCount={totalCount}
                onDelete={handleDeleteImage}
                onRegenerate={handleRegenerateImage}
                onApproveStyle={handleApproveStyle}
                onRedo={handleRedo}
                onRetryGeneration={handleRetryGeneration}
                hasError={state.generationFailed}
                isGenerating={isGenerationActive}
                approvalGranted={approvalGranted}
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
                      disabled={!canBuildStampSet}
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
