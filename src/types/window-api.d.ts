/**
 * window.api のアンビエント型宣言（レンダラ用）。
 *
 * 実体は electron/preload.ts（タスク 18.2）が contextBridge で公開する。
 * ここでは App がコンパイル・実行できるように **オプショナル** な最小契約を宣言する。
 *
 * 設計方針:
 * - preload.ts の現行 `window.api` 形状（ネスト構造）に合わせる。
 * - すべてオプショナル（`api?`, 各メソッドも省略可能）にして、タスク 18.2 側の
 *   厳密な型定義（WindowApi）と衝突しないようにする。
 * - 進捗ストリーム（image:generate:progress / upload:progress）の購読は preload に
 *   まだ存在しない可能性があるため、購読メソッドもオプショナルで宣言し、
 *   実行時に存在チェックしてから使う（存在しなければグレースフルにフォールバック）。
 *
 * electron/main.ts の IPC チャネル契約:
 *   config:get / config:save / config:export / config:import
 *   credential:save / credential:get
 *   image:process
 *   logs:get
 *   image:generate（進捗は "image:generate:progress" へ push）
 *   upload:start（進捗は "upload:progress" へ push）
 */

import type {
  Config,
  GenerationRequest,
  LogEntry,
} from "./index";

/**
 * SSE ストリームの push ペイロード（両ストリーム共通）。
 * electron/main.ts の streamSse が送出する形状に一致する。
 */
export interface StreamPushPayload {
  streamId: string;
  event: "progress" | "done" | "error" | "message";
  data: unknown;
}

/**
 * レンダラに公開される window.api の最小・オプショナル契約。
 * 実装（preload.ts）はこれと互換であればよい。
 */
export interface RendererApi {
  config?: {
    get?: () => Promise<Config>;
    save?: (config: Config) => Promise<unknown>;
    export?: () => Promise<Record<string, unknown>>;
    import?: (data: Record<string, unknown>) => Promise<unknown>;
  };
  credential?: {
    save?: (key: string, value: string) => Promise<unknown>;
    get?: (key: string) => Promise<unknown>;
  };
  image?: {
    generate?: (request: GenerationRequest) => Promise<unknown>;
    process?: (sourcePath: string) => Promise<unknown>;
  };
  upload?: {
    start?: (request: unknown) => Promise<unknown>;
  };
  logs?: {
    get?: (params: {
      level?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
    }) => Promise<LogEntry[]>;
  };
  /**
   * 生成進捗（image:generate:progress）の購読。
   * 戻り値は購読解除関数（存在すれば）。preload 未実装の場合は undefined。
   */
  onGenerateProgress?: (
    listener: (payload: StreamPushPayload) => void,
  ) => (() => void) | void;
  /**
   * アップロード進捗（upload:progress）の購読。
   * 戻り値は購読解除関数（存在すれば）。preload 未実装の場合は undefined。
   */
  onUploadProgress?: (
    listener: (payload: StreamPushPayload) => void,
  ) => (() => void) | void;
}

declare global {
  interface Window {
    /** preload.ts が公開する IPC API（存在しない環境=テスト/開発では undefined） */
    api?: RendererApi;
  }
}

export {};
