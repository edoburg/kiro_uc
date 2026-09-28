import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  WebContents,
} from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as http from "http";
import type {
  Config,
  GenerationStartRequest,
  ProcessedImageSet,
} from "../src/types/index";
import type {
  ExportBackendRequest,
  ExportCreateRequest,
  ExportResult,
  StatusResponse,
  UploadStartRequest,
} from "../src/types/ipc";

/**
 * Electron メインプロセス。
 *
 * 責務:
 *   1. Python FastAPI バックエンド（backend.main:app, localhost:8765）を子プロセスとして
 *      起動・監視・終了管理する。
 *   2. レンダラ ↔ バックエンドの IPC ブリッジ（`ipcMain.handle` による HTTP プロキシ）。
 *
 * IPC 境界のルール（structure.md）:
 *   レンダラは Python を直接呼ばない。すべての呼び出しは
 *     window.api（preload.ts）→ ipcMain.handle → FastAPI localhost
 *   の経路を通る。
 *
 * セキュリティ（tech.md）:
 *   - contextIsolation: true / nodeIntegration: false
 *   - クレデンシャル（api_key / password）は値をログに出力しない
 *
 * ============================================================================
 * IPC チャネル契約（preload.ts の window.api と一致させること。task 18.2 参照）
 * ============================================================================
 *
 * リクエスト/レスポンス型（ipcRenderer.invoke → Promise を返す）:
 *   "config:get"          () -> Config
 *   "config:save"         (config: Config) -> { status, message }
 *   "config:export"       () -> Config                    （センシティブフィールド除外）
 *   "config:import"      (config: Config) -> { status, message }
 *   "credential:save"     (key: string, value: string) -> { status, key }
 *   "credential:get"      (key: string) -> { key, configured: boolean }
 *   "image:process"       (sourcePath: string) -> ProcessedImageSet
 *   "archive:create"      (request: ExportCreateRequest) -> ExportResult | null
 *   "logs:get"            (params) -> LogEntry[]
 *
 * ストリーミング型（SSE を購読し、進捗を webContents.send で push する）:
 *   "image:generate"      (request: GenerationRequest) -> { streamId }
 *       進捗イベントは "image:generate:progress" チャネルへ push。
 *   "upload:start"        (request) -> { streamId }
 *       進捗イベントは "upload:progress" チャネルへ push。
 *
 *   push ペイロード（両ストリーム共通）:
 *     { streamId: string, event: "progress" | "done" | "error", data: unknown }
 *   最後に必ず "done" または "error" が 1 回 push され、その後ストリームは終了する。
 * ============================================================================
 */

// --- Python FastAPI backend process ---
let pythonProcess: ChildProcess | null = null;
const BACKEND_PORT = 8765;
const BACKEND_HOST = "127.0.0.1";
const BACKEND_BASE_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

// SSE 進捗 push 用のチャネル名
const CH_GENERATE_PROGRESS = "image:generate:progress";
const CH_UPLOAD_PROGRESS = "upload:progress";

// 一意なストリーム ID を採番するためのカウンタ
let streamCounter = 0;
function nextStreamId(prefix: string): string {
  streamCounter += 1;
  return `${prefix}-${Date.now()}-${streamCounter}`;
}

/**
 * Python FastAPI バックエンド子プロセスを起動する。
 */
function startPythonBackend(): void {
  const pythonExecutable = process.platform === "win32" ? "python" : "python3";

  pythonProcess = spawn(
    pythonExecutable,
    [
      "-m",
      "uvicorn",
      "backend.main:app",
      "--host",
      BACKEND_HOST,
      "--port",
      String(BACKEND_PORT),
      "--no-access-log",
    ],
    {
      // バックエンドをリポジトリルート（backend パッケージの親）から実行する
      cwd: path.join(__dirname, ".."),
    }
  );

  pythonProcess.stdout?.on("data", (data: Buffer) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  pythonProcess.stderr?.on("data", (data: Buffer) => {
    console.error(`[Backend Error] ${data.toString().trim()}`);
  });

  pythonProcess.on("close", (code: number | null) => {
    console.log(`[Backend] Process exited with code ${code}`);
    pythonProcess = null;
  });
}

/**
 * Python バックエンドが起動して /health が 200 を返すまで待機する。
 * ウィンドウ生成前に呼び出す。
 */
async function waitForBackend(maxRetries = 40, intervalMs = 500): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`${BACKEND_BASE_URL}/health`, (res) => {
          // レスポンスボディを排出してソケットを解放する
          res.resume();
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Status: ${res.statusCode}`));
          }
        });
        req.on("error", reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error("Python backend failed to start");
}

/**
 * Python バックエンド子プロセスを確実に終了する。
 */
function stopPythonBackend(): void {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
}

// ---------------------------------------------------------------------------
// リクエスト/レスポンス型 HTTP プロキシ
// ---------------------------------------------------------------------------

/**
 * HTTP リクエストをバックエンドへプロキシする汎用ヘルパー。
 *
 * 4xx/5xx の場合は FastAPI が返す `detail`（日本語エラーメッセージ）を含む Error を
 * reject する。レンダラ側で catch してユーザーに提示できる。
 */
async function proxyRequest<T>(
  method: string,
  apiPath: string,
  body?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BACKEND_BASE_URL}${apiPath}`);
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          if (raw.length === 0) {
            resolve(undefined as T);
            return;
          }
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(new Error(`レスポンスの解析に失敗しました: ${raw}`));
          }
          return;
        }
        // エラー: FastAPI の detail を取り出す
        let message = `バックエンドがエラーを返しました（status ${status}）。`;
        try {
          const parsed = JSON.parse(raw) as { detail?: unknown };
          if (parsed && typeof parsed.detail === "string") {
            message = parsed.detail;
          }
        } catch {
          // detail が取れなければ既定メッセージのまま
        }
        reject(new Error(message));
      });
    });

    req.on("error", reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// SSE（text/event-stream）ストリーミングプロキシ
// ---------------------------------------------------------------------------

interface SseMessage {
  event: string;
  data: unknown;
}

/**
 * バックエンドの SSE エンドポイントに POST し、受信した各イベントを
 * webContents.send(channel, ...) でレンダラへ push する。
 *
 * バックエンドのフレーミング（backend/main.py の _sse_event と一致）:
 *   event: <name>\n
 *   data: <json>\n
 *   \n
 * を 1 メッセージとして解析する。event 行が無い場合は "message" 扱いにする。
 *
 * 進捗は受信ごとに即時 push されるため、~1 秒以内の更新間隔を満たす（Requirements 5.2）。
 */
function streamSse(
  webContents: WebContents,
  channel: string,
  streamId: string,
  apiPath: string,
  body: unknown
): void {
  const url = new URL(`${BACKEND_BASE_URL}${apiPath}`);
  const bodyStr = JSON.stringify(body ?? {});

  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Content-Length": Buffer.byteLength(bodyStr),
    },
  };

  const send = (message: SseMessage): void => {
    if (webContents.isDestroyed()) {
      return;
    }
    webContents.send(channel, {
      streamId,
      event: message.event,
      data: message.data,
    });
  };

  const req = http.request(options, (res) => {
    res.setEncoding("utf-8");

    const status = res.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      // 非 2xx: ボディを読んでエラーとして 1 回だけ push する
      let raw = "";
      res.on("data", (chunk: string) => {
        raw += chunk;
      });
      res.on("end", () => {
        let message = `バックエンドがエラーを返しました（status ${status}）。`;
        try {
          const parsed = JSON.parse(raw) as { detail?: unknown };
          if (parsed && typeof parsed.detail === "string") {
            message = parsed.detail;
          }
        } catch {
          // 既定メッセージのまま
        }
        send({ event: "error", data: { message } });
      });
      return;
    }

    let buffer = "";
    res.on("data", (chunk: string) => {
      buffer += chunk;
      // イベントは空行（\n\n）で区切られる
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const parsed = parseSseEvent(rawEvent);
        if (parsed) {
          send(parsed);
        }
      }
    });

    res.on("end", () => {
      // 末尾に区切りなしで残ったイベントがあれば処理する
      const rest = buffer.trim();
      if (rest.length > 0) {
        const parsed = parseSseEvent(rest);
        if (parsed) {
          send(parsed);
        }
      }
    });

    res.on("error", (err: Error) => {
      send({ event: "error", data: { message: err.message } });
    });
  });

  req.on("error", (err: Error) => {
    send({
      event: "error",
      data: {
        message: "バックエンドとの通信に失敗しました。",
        detail: err.message,
      },
    });
  });

  req.write(bodyStr);
  req.end();
}

/**
 * 1 件分の SSE テキストブロックを { event, data } に解析する。
 * "event:" 行と "data:" 行（複数行の data 連結に対応）を読む。
 */
function parseSseEvent(rawEvent: string): SseMessage | null {
  const lines = rawEvent.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const dataStr = dataLines.join("\n");
  let data: unknown = dataStr;
  try {
    data = JSON.parse(dataStr);
  } catch {
    // JSON でなければ生文字列のまま渡す
  }
  return { event, data };
}

// ---------------------------------------------------------------------------
// IPC ハンドラ登録
// ---------------------------------------------------------------------------

// --- Config ---

/** 設定を取得する */
ipcMain.handle("config:get", async () => {
  return proxyRequest<Config>("GET", "/config");
});

/** 設定を保存する */
ipcMain.handle("config:save", async (_event: IpcMainInvokeEvent, config: Config) => {
  return proxyRequest<StatusResponse>("POST", "/config", config);
});

/** 設定をエクスポートする（センシティブフィールドを除外） */
ipcMain.handle("config:export", async () => {
  return proxyRequest<Config>("GET", "/config/export");
});

/** 設定をインポートする */
ipcMain.handle("config:import", async (_event: IpcMainInvokeEvent, config: Config) => {
  return proxyRequest<StatusResponse>("POST", "/config/import", config);
});

// --- Credentials (OS Keychain) ---
// 注意: value はプロキシ経由でバックエンドへ渡すのみ。ログには出力しない。

/** クレデンシャルを OS Keychain に保存する */
ipcMain.handle(
  "credential:save",
  async (_event: IpcMainInvokeEvent, key: string, value: string) => {
    return proxyRequest("POST", "/config/credential", { key, value });
  }
);

/** クレデンシャルの設定有無を確認する（値は返らない） */
ipcMain.handle("credential:get", async (_event: IpcMainInvokeEvent, key: string) => {
  return proxyRequest("GET", `/config/credential/${encodeURIComponent(key)}`);
});

// --- Image processing（同期レスポンス） ---

/** 画像処理（LINE規格変換）を実行する */
ipcMain.handle("image:process", async (_event: IpcMainInvokeEvent, sourcePath: string) => {
  return proxyRequest<ProcessedImageSet>("POST", "/process", { sourcePath });
});

// --- ZIP export（ネイティブ保存先選択 + 同期レスポンス） ---

ipcMain.handle(
  "archive:create",
  async (
    event: IpcMainInvokeEvent,
    request: ExportCreateRequest
  ): Promise<ExportResult | null> => {
    const options: OpenDialogOptions = {
      title: "ZIPの保存先フォルダーを選択",
      buttonLabel: "このフォルダーに保存",
      properties: ["openDirectory", "createDirectory"],
      ...(request.defaultDirectory.trim()
        ? { defaultPath: request.defaultDirectory }
        : {}),
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) {
      return null;
    }

    const backendRequest: ExportBackendRequest = {
      stampSet: request.stampSet,
      outputDirectory: selection.filePaths[0],
    };
    return proxyRequest<ExportResult>("POST", "/export", backendRequest);
  }
);

// --- Logs ---

/** ログエントリを取得する */
ipcMain.handle(
  "logs:get",
  async (
    _event: IpcMainInvokeEvent,
    params: { level?: string; dateFrom?: string; dateTo?: string; limit?: number } = {}
  ) => {
    const query = new URLSearchParams();
    if (params.level) query.set("level", params.level);
    if (params.dateFrom) query.set("date_from", params.dateFrom);
    if (params.dateTo) query.set("date_to", params.dateTo);
    if (params.limit != null) query.set("limit", String(params.limit));
    return proxyRequest("GET", `/logs?${query.toString()}`);
  }
);

// --- Image generation（SSE ストリーミング） ---

/**
 * AI 画像生成を開始する。進捗は CH_GENERATE_PROGRESS チャネルへ push される。
 * invoke の戻り値は購読用の streamId。
 */
ipcMain.handle("image:generate", async (event: IpcMainInvokeEvent, request: GenerationStartRequest) => {
  const streamId = nextStreamId("generate");
  streamSse(event.sender, CH_GENERATE_PROGRESS, streamId, "/generate", {
    ...request,
    generationId: streamId,
  });
  return { streamId };
});

// --- Upload（SSE ストリーミング） ---

/**
 * LINE Creators Market へのアップロードを開始する。進捗は CH_UPLOAD_PROGRESS
 * チャネルへ push される。invoke の戻り値は購読用の streamId。
 */
ipcMain.handle("upload:start", async (event: IpcMainInvokeEvent, request: UploadStartRequest) => {
  const streamId = nextStreamId("upload");
  streamSse(event.sender, CH_UPLOAD_PROGRESS, streamId, "/upload", request);
  return { streamId };
});

// ---------------------------------------------------------------------------
// Electron アプリライフサイクル
// ---------------------------------------------------------------------------

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env["VITE_DEV_SERVER_URL"]) {
    mainWindow.loadURL(process.env["VITE_DEV_SERVER_URL"]);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  startPythonBackend();

  try {
    await waitForBackend();
    console.log("[Main] Backend is ready");
  } catch (err) {
    console.error("[Main] Backend startup failed:", err);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // ウィンドウが全て閉じられたらバックエンド子プロセスも終了する
  stopPythonBackend();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopPythonBackend();
});
