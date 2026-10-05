/** Electron IPCを通じてレンダラーへ公開するAPI契約。 */

import type {
  Config,
  GenerationStartRequest,
  LogEntry,
  ProcessedImageSet,
  StampSet,
  UploadResult,
} from "./index";

export interface StatusResponse {
  status: string;
  message?: string;
}

export interface CredentialSaveResponse {
  status: string;
  key: string;
}

export interface CredentialStatusResponse {
  key: string;
  configured: boolean;
}

export interface StreamHandle {
  streamId: string;
}

export interface ExportImageRequest {
  stampPath: string;
  mainImagePath: string;
  thumbnailPath: string;
}

export interface ExportCreateRequest {
  stampSet: {
    title: string;
    description: string;
    images: ExportImageRequest[];
  };
  defaultDirectory: string;
}

export interface ExportBackendRequest {
  stampSet: ExportCreateRequest["stampSet"];
  outputDirectory: string;
}

export interface ExportResult {
  zipPath: string;
  fileName: string;
  imageCount: number;
}

export interface LogQueryParams {
  level?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface GenerationProgressPayload {
  completed: number;
  total: number;
  latestImagePath: string | null;
  index: number;
  dataUrl: string | null;
  error: {
    index: number;
    errorType: "timeout" | "api_error" | "unknown";
    message: string;
  } | null;
}

export interface GenerationDonePayload {
  status: "done" | "partial" | "failed";
  total: number;
  succeeded: number;
  failed: number;
}

export interface UploadProgressPayload {
  phase:
    | "login"
    | "uploading"
    | "saving"
    | "submitting"
    | "done"
    | "retrying";
  completed: number;
  total: number;
  message: string;
}

export interface UploadImageRequest {
  stampPath: string;
  mainImagePath: string;
  thumbnailPath: string;
}

export interface UploadStartRequest {
  stampSet: {
    title: string;
    description: string;
    creatorName: string;
    copyright: string;
    images: UploadImageRequest[];
    mainImagePath: string | null;
    thumbnailPath: string | null;
  };
  emailCredentialKey: "line_email";
  passwordCredentialKey: "line_password";
}

export interface UploadResultPayload {
  success: boolean;
  applicationId: string | null;
  status: string | null;
  errorType: UploadResult["errorType"] | null;
  retryCount: number;
  errorMessage: string | null;
}

export interface StreamErrorPayload {
  status?: string;
  errorType?: UploadResult["errorType"];
  message: string;
  detail?: string;
}

export type GenerationStreamPayload =
  | { streamId: string; event: "progress"; data: GenerationProgressPayload }
  | { streamId: string; event: "done"; data: GenerationDonePayload }
  | { streamId: string; event: "error"; data: StreamErrorPayload }
  | { streamId: string; event: "message"; data: unknown };

export type UploadStreamPayload =
  | { streamId: string; event: "progress"; data: UploadProgressPayload }
  | { streamId: string; event: "done"; data: UploadResultPayload }
  | {
      streamId: string;
      event: "error";
      data: UploadResultPayload | StreamErrorPayload;
    }
  | { streamId: string; event: "message"; data: unknown };

export interface RendererApi {
  generationPresets: {
    list: () => Promise<import("./index").GenerationPresetList>;
    load: (id: string) => Promise<import("./index").GenerationPreset>;
    save: (input: import("./index").GenerationPresetSave) => Promise<import("./index").GenerationPreset>;
    delete: (id: string) => Promise<void>;
  };
  config: {
    get: () => Promise<Config>;
    save: (config: Config) => Promise<StatusResponse>;
    export: () => Promise<Config>;
    import: (config: Config) => Promise<StatusResponse>;
  };
  credential: {
    save: (key: string, value: string) => Promise<CredentialSaveResponse>;
    get: (key: string) => Promise<CredentialStatusResponse>;
  };
  image: {
    generate: (request: GenerationStartRequest) => Promise<StreamHandle>;
    process: (sourcePath: string) => Promise<ProcessedImageSet>;
  };
  archive: {
    create: (request: ExportCreateRequest) => Promise<ExportResult | null>;
  };
  upload: {
    start: (request: UploadStartRequest) => Promise<StreamHandle>;
  };
  logs: {
    get: (params?: LogQueryParams) => Promise<LogEntry[]>;
  };
  onGenerateProgress: (
    listener: (payload: GenerationStreamPayload) => void,
  ) => () => void;
  onUploadProgress: (
    listener: (payload: UploadStreamPayload) => void,
  ) => () => void;
}

/** ドメインのStampSetからAPI要求を組み立てる関数の型。 */
export type UploadRequestMapper = (stampSet: StampSet) => UploadStartRequest;
