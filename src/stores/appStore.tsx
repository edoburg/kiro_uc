import React, {
  createContext,
  useContext,
  useMemo,
  useReducer,
} from "react";
import type {
  Config,
  GeneratedImage,
  GenerationRequest,
  StampImage,
  StampSet,
  UploadResult,
} from "../types/index";
import type { UploadProgress } from "../components/UploadPanel";
import { recalculateStampSet } from "../utils/stampSet";

/**
 * アプリのグローバル状態（React Context + useReducer）。
 *
 * structure.md（状態管理は Zustand または React Context）に従い、
 * 生成フロー（PromptInput → ImagePreviewGrid → StampSetEditor → UploadPanel）で
 * 共有する状態をここに集約する。
 *
 * 共有する主要ドメイン状態（タスク 18.1 の要件）:
 *   - GenerationRequest        現在の生成リクエスト
 *   - GeneratedImage[]         生成済み画像一覧
 *   - StampSet                 LINE 規格変換済みスタンプセット
 *   - UploadResult             アップロード結果
 *
 * 加えて、フロー制御・設定・エラー表示に必要な状態も保持する。
 * ユーザー向けエラーメッセージはすべて日本語（product.md）。
 */

/** 生成フローの画面ステップ */
export type FlowStep =
  | "prompt"
  | "plan"
  | "generating"
  | "preview"
  | "processing"
  | "edit"
  | "upload";

/** 補助パネル（メインフローとは独立して開閉する画面） */
export type PanelView = "config" | "logs" | null;

export interface AppState {
  /** 現在の設定（未取得なら null） */
  config: Config | null;
  /** 初回セットアップが必要か（Config 未設定 or APIキー未設定） */
  needsSetup: boolean;
  /** AI 画像生成 API キーがキーチェーンに設定済みか */
  aiApiKeyConfigured: boolean;
  /** LINE Creators Market の認証情報が設定済みか */
  lineCredentialsConfigured: boolean;

  /** 現在の生成リクエスト */
  currentRequest: GenerationRequest | null;
  draftRequest: GenerationRequest | null;
  /** 生成済み画像一覧 */
  generatedImages: GeneratedImage[];
  /** LINE 規格変換済みのスタンプセット */
  stampSet: StampSet | null;
  /** アップロード進捗（アップロード中のみ非 null） */
  uploadProgress: UploadProgress | null;
  /** アップロード結果（完了後のみ非 null） */
  uploadResult: UploadResult | null;

  /** 現在の生成フロー画面 */
  step: FlowStep;
  /** メインフローに重ねて開く補助パネル */
  panel: PanelView;
  /** 生成プロセス全体が失敗したか（ImagePreviewGrid の hasError 用） */
  generationFailed: boolean;
  /** ユーザー向けエラーメッセージ（日本語、非 null で表示） */
  error: string | null;
}

/** 状態遷移アクション */
export type AppAction =
  | { type: "SET_CONFIG"; config: Config }
  | {
      type: "SET_SETUP_STATUS";
      needsSetup: boolean;
      aiApiKeyConfigured: boolean;
      lineCredentialsConfigured: boolean;
    }
  | { type: "SET_AI_API_KEY_CONFIGURED"; configured: boolean }
  | { type: "SET_LINE_CREDENTIALS_CONFIGURED"; configured: boolean }
  | { type: "COMPLETE_SETUP" }
  | { type: "START_GENERATION"; request: GenerationRequest }
  | { type: "SET_DRAFT_REQUEST"; request: GenerationRequest }
  | { type: "SET_GENERATED_IMAGES"; images: GeneratedImage[] }
  | { type: "UPSERT_GENERATED_IMAGE"; image: GeneratedImage }
  | { type: "DELETE_GENERATED_IMAGE"; index: number }
  | { type: "GENERATION_COMPLETE" }
  | { type: "GENERATION_PARTIAL"; message: string }
  | { type: "GENERATION_FAILED"; message: string }
  | { type: "START_STAMP_SET_PROCESSING" }
  | { type: "SET_STAMP_SET"; stampSet: StampSet }
  | { type: "START_STAMP_IMAGE_PROCESSING"; index: number; sourcePath: string }
  | { type: "UPDATE_STAMP_IMAGE"; index: number; image: StampImage }
  | { type: "STAMP_IMAGE_PROCESS_FAILED"; index: number; message: string }
  | { type: "UPDATE_STAMP_SET_TITLE"; title: string }
  | { type: "UPDATE_STAMP_SET_DESCRIPTION"; description: string }
  | { type: "UPDATE_STAMP_SET_CREATOR_NAME"; creatorName: string }
  | { type: "UPDATE_STAMP_SET_COPYRIGHT"; copyright: string }
  | { type: "START_UPLOAD" }
  | { type: "SET_UPLOAD_PROGRESS"; progress: UploadProgress | null }
  | { type: "SET_UPLOAD_RESULT"; result: UploadResult }
  | { type: "GO_TO_STEP"; step: FlowStep }
  | { type: "OPEN_PANEL"; panel: Exclude<PanelView, null> }
  | { type: "CLOSE_PANEL" }
  | { type: "SET_ERROR"; message: string | null }
  | { type: "CLEAR_ERROR" };

/** 初期状態 */
export const initialAppState: AppState = {
  config: null,
  needsSetup: true,
  aiApiKeyConfigured: false,
  lineCredentialsConfigured: false,
  currentRequest: null,
  draftRequest: null,
  generatedImages: [],
  stampSet: null,
  uploadProgress: null,
  uploadResult: null,
  step: "prompt",
  panel: null,
  generationFailed: false,
  error: null,
};

/**
 * 状態遷移リデューサ（純粋関数）。
 * テスト可能なようにエクスポートする。
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_CONFIG":
      return { ...state, config: action.config };

    case "SET_SETUP_STATUS":
      return {
        ...state,
        needsSetup: action.needsSetup,
        aiApiKeyConfigured: action.aiApiKeyConfigured,
        lineCredentialsConfigured: action.lineCredentialsConfigured,
      };

    case "SET_AI_API_KEY_CONFIGURED":
      return { ...state, aiApiKeyConfigured: action.configured };

    case "SET_LINE_CREDENTIALS_CONFIGURED":
      return { ...state, lineCredentialsConfigured: action.configured };

    case "COMPLETE_SETUP":
      return { ...state, needsSetup: false };

    case "START_GENERATION":
      return {
        ...state,
        currentRequest: action.request,
        draftRequest: null,
        generatedImages: [],
        stampSet: null,
        uploadResult: null,
        uploadProgress: null,
        generationFailed: false,
        error: null,
        step: "generating",
      };

    case "SET_DRAFT_REQUEST":
      return { ...state, draftRequest: action.request, step: "plan", error: null };

    case "SET_GENERATED_IMAGES":
      return { ...state, generatedImages: action.images };

    case "UPSERT_GENERATED_IMAGE": {
      const exists = state.generatedImages.some(
        (img) => img.index === action.image.index,
      );
      const images = exists
        ? state.generatedImages.map((img) =>
            img.index === action.image.index ? action.image : img,
          )
        : [...state.generatedImages, action.image].sort(
            (a, b) => a.index - b.index,
          );
      return { ...state, generatedImages: images };
    }

    case "DELETE_GENERATED_IMAGE":
      return {
        ...state,
        generatedImages: state.generatedImages.filter(
          (img) => img.index !== action.index,
        ),
      };

    case "GENERATION_COMPLETE":
      return { ...state, step: "preview", generationFailed: false, error: null };

    case "GENERATION_PARTIAL":
      return {
        ...state,
        step: "preview",
        generationFailed: false,
        error: action.message,
      };

    case "GENERATION_FAILED":
      return {
        ...state,
        step: "preview",
        generationFailed: true,
        error: action.message,
      };

    case "START_STAMP_SET_PROCESSING":
      return { ...state, step: "processing", error: null };

    case "SET_STAMP_SET":
      return {
        ...state,
        stampSet: recalculateStampSet(action.stampSet),
        step: "edit",
      };

    case "START_STAMP_IMAGE_PROCESSING":
      return state.stampSet
        ? {
            ...state,
            stampSet: recalculateStampSet({
              ...state.stampSet,
              images: state.stampSet.images.map((image, index) =>
                index === action.index
                  ? {
                      ...image,
                      sourcePath: action.sourcePath,
                      processingStatus: "processing",
                      processingError: undefined,
                    }
                  : image,
              ),
            }),
          }
        : state;

    case "UPDATE_STAMP_IMAGE":
      return state.stampSet
        ? {
            ...state,
            stampSet: recalculateStampSet({
              ...state.stampSet,
              images: state.stampSet.images.map((image, index) =>
                index === action.index ? action.image : image,
              ),
            }),
          }
        : state;

    case "STAMP_IMAGE_PROCESS_FAILED":
      return state.stampSet
        ? {
            ...state,
            stampSet: recalculateStampSet({
              ...state.stampSet,
              images: state.stampSet.images.map((image, index) =>
                index === action.index
                  ? {
                      ...image,
                      processingStatus: "error",
                      processingError: action.message,
                      validationResult: {
                        ...image.validationResult,
                        passed: false,
                        details: action.message,
                      },
                    }
                  : image,
              ),
            }),
          }
        : state;

    case "UPDATE_STAMP_SET_TITLE":
      return state.stampSet
        ? {
            ...state,
            stampSet: recalculateStampSet({
              ...state.stampSet,
              title: action.title,
            }),
          }
        : state;

    case "UPDATE_STAMP_SET_DESCRIPTION":
      return state.stampSet
        ? {
            ...state,
            stampSet: recalculateStampSet({
              ...state.stampSet,
              description: action.description,
            }),
          }
        : state;

    case "UPDATE_STAMP_SET_CREATOR_NAME":
      return state.stampSet
        ? {
            ...state,
            stampSet: recalculateStampSet({
              ...state.stampSet,
              creatorName: action.creatorName,
            }),
          }
        : state;

    case "UPDATE_STAMP_SET_COPYRIGHT":
      return state.stampSet
        ? {
            ...state,
            stampSet: recalculateStampSet({
              ...state.stampSet,
              copyright: action.copyright,
            }),
          }
        : state;

    case "START_UPLOAD":
      return {
        ...state,
        step: "upload",
        uploadResult: null,
        uploadProgress: null,
        error: null,
      };

    case "SET_UPLOAD_PROGRESS":
      return { ...state, uploadProgress: action.progress };

    case "SET_UPLOAD_RESULT":
      return {
        ...state,
        uploadResult: action.result,
        uploadProgress: null,
      };

    case "GO_TO_STEP":
      return { ...state, step: action.step };

    case "OPEN_PANEL":
      return { ...state, panel: action.panel };

    case "CLOSE_PANEL":
      return { ...state, panel: null };

    case "SET_ERROR":
      return { ...state, error: action.message };

    case "CLEAR_ERROR":
      return { ...state, error: null };

    default:
      return state;
  }
}

interface AppStoreContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppStoreContext = createContext<AppStoreContextValue | null>(null);

/**
 * グローバル状態プロバイダ。App のルートで一度だけラップする。
 * テスト時に初期状態を注入できるよう initialState を受け取れる。
 */
export const AppStoreProvider: React.FC<{
  children: React.ReactNode;
  initialState?: AppState;
}> = ({ children, initialState = initialAppState }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <AppStoreContext.Provider value={value}>
      {children}
    </AppStoreContext.Provider>
  );
};

/** グローバル状態へアクセスするフック。Provider 外での使用はエラー。 */
export function useAppStore(): AppStoreContextValue {
  const ctx = useContext(AppStoreContext);
  if (ctx === null) {
    throw new Error("useAppStore は AppStoreProvider の内側で使用してください");
  }
  return ctx;
}
