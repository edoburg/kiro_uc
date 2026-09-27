/** Electron IPCを通じてレンダラーへ公開するAPI契約。 */

import type {
  Config,
  GenerationRequest,
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

export interface UploadProgressPayload {
  phase: "login" | "uploading" | "submitting" | "done" | "retrying";
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
  | { streamId: string; event: "done"; data: { status: string } }
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
    generate: (request: GenerationRequest) => Promise<StreamHandle>;
    process: (sourcePath: string) => Promise<ProcessedImageSet>;
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
