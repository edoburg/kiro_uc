import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type {
  GenerationRequest,
  Config,
  LogEntry,
} from "../src/types/index";
import type { StreamPushPayload } from "../src/types/window-api";

/**
 * レンダラープロセスに公開する window.api インターフェース（preload / task 18.2）。
 *
 * IPC 境界のルール（structure.md）:
 *   レンダラは Python を直接呼ばない。すべての呼び出しは
 *     window.api（preload.ts）→ ipcMain.handle（main.ts）→ FastAPI localhost
 *   の経路を通る。ここでは ipcRenderer.invoke / ipcRenderer.on のみを内部で使い、
 *   ipcRenderer 自体はレンダラへ公開しない（contextIsolation 前提）。
 *
 * チャネル契約は electron/main.ts の ipcMain.handle と一致させること。
 * 公開する形状は src/types/window-api.d.ts の RendererApi と互換であること。
 *
 * セキュリティ（tech.md）:
 *   - contextIsolation: true / nodeIntegration: false
 *   - クレデンシャル（api_key / password）の値はログに出力しない
 */

// --- リクエスト/レスポンス型 ---

/** config:save / config:import の戻り値 */
interface StatusResponse {
  status: string;
  message?: string;
}

/** credential:save の戻り値 */
interface CredentialSaveResponse {
  status: string;
  key: string;
}

/** credential:get の戻り値（値は返らず、設定有無のみ） */
interface CredentialStatusResponse {
  key: string;
  configured: boolean;
}

/** image:generate / upload:start の戻り値（進捗購読用の streamId） */
interface StreamHandle {
  streamId: string;
}

/** logs:get のクエリパラメータ */
interface LogQueryParams {
  level?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

// SSE 進捗 push 用のチャネル名（main.ts と一致させること）
const CH_GENERATE_PROGRESS = "image:generate:progress";
const CH_UPLOAD_PROGRESS = "upload:progress";

/**
 * 進捗 push チャネルを購読し、ペイロードをリスナへ転送する。
 * 戻り値の関数を呼ぶと購読を解除する（ipcRenderer.removeListener でリーク防止）。
 */
function subscribe(
  channel: string,
  listener: (payload: StreamPushPayload) => void
): () => void {
  const handler = (_event: IpcRendererEvent, payload: StreamPushPayload): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api = {
  // --- Config ---
  config: {
    /** 現在の設定を取得する */
    get: (): Promise<Config> => ipcRenderer.invoke("config:get"),
    /** 設定を保存する */
    save: (config: Config): Promise<StatusResponse> =>
      ipcRenderer.invoke("config:save", config),
    /** 設定をエクスポートする（センシティブフィールドはバックエンドで除外済み） */
    export: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("config:export"),
    /** 設定をインポートする */
    import: (data: Record<string, unknown>): Promise<StatusResponse> =>
      ipcRenderer.invoke("config:import", data),
  },

  // --- Credentials (OS Keychain) ---
  // 注意: value は invoke 経由で main → バックエンドへ渡すのみ。ログには出力しない。
  credential: {
    /** クレデンシャルを OS Keychain に保存する */
    save: (key: string, value: string): Promise<CredentialSaveResponse> =>
      ipcRenderer.invoke("credential:save", key, value),
    /** クレデンシャルの設定有無を確認する（値は返らない） */
    get: (key: string): Promise<CredentialStatusResponse> =>
      ipcRenderer.invoke("credential:get", key),
  },

  // --- Image ---
  image: {
    /**
     * AI 画像生成を開始する。戻り値は購読用の streamId。
     * 進捗は onGenerateProgress で購読する。
     */
    generate: (request: GenerationRequest): Promise<StreamHandle> =>
      ipcRenderer.invoke("image:generate", request),
    /**
     * 画像処理（LINE規格変換）を実行する（同期レスポンス）。
     * 戻り値はバックエンドの ProcessedImageSet（Python 側モデル）。
     */
    process: (sourcePath: string): Promise<unknown> =>
      ipcRenderer.invoke("image:process", sourcePath),
  },

  // --- Upload ---
  upload: {
    /**
     * LINE Creators Market へのアップロードを開始する。戻り値は購読用の streamId。
     * 進捗は onUploadProgress で購読する。
     */
    start: (request: unknown): Promise<StreamHandle> =>
      ipcRenderer.invoke("upload:start", request),
  },

  // --- Logs ---
  logs: {
    /** ログエントリを取得する */
    get: (params: LogQueryParams = {}): Promise<LogEntry[]> =>
      ipcRenderer.invoke("logs:get", params),
  },

  // --- 進捗ストリーム購読 ---
  /**
   * 生成進捗（image:generate:progress）を購読する。
   * 戻り値は購読解除関数。リスナは push ペイロード
   * { streamId, event, data } を受け取る。
   */
  onGenerateProgress: (listener: (payload: StreamPushPayload) => void): (() => void) =>
    subscribe(CH_GENERATE_PROGRESS, listener),

  /**
   * アップロード進捗（upload:progress）を購読する。
   * 戻り値は購読解除関数。
   */
  onUploadProgress: (listener: (payload: StreamPushPayload) => void): (() => void) =>
    subscribe(CH_UPLOAD_PROGRESS, listener),
} as const;

// contextIsolation を有効にした上で window.api として公開する
contextBridge.exposeInMainWorld("api", api);

// TypeScript 用の型定義（レンダラー側で import できるように）
export type WindowApi = typeof api;
