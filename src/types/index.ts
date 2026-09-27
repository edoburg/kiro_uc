/**
 * LINEスタンプジェネレーター 共有型定義
 *
 * すべてのドメイン型はここに定義する。
 */

// --- スタンプ生成パラメータ ---

/** 生成するスタンプ枚数（LINE規格: 8/16/24/32/40枚） */
export type StampCount = 8 | 16 | 24 | 32 | 40;

/** 生成スタイル */
export type GenerationStyle = "かわいい" | "クール" | "ゆるい" | "リアル";

/** 生成モード */
export type GenerationMode = "batch" | "preview_approval";

/** AI 画像生成リクエスト */
export interface GenerationRequest {
  /** 生成条件を記述する自然言語テキスト（最大 1000 文字） */
  prompt: string;
  /** 生成するスタンプ枚数 */
  count: StampCount;
  /** 生成スタイル（省略可能） */
  style?: GenerationStyle;
  /** 生成モード（一括 or プレビュー承認） */
  mode: GenerationMode;
}

// --- 生成画像 ---

/** AI が生成した個別画像 */
export interface GeneratedImage {
  /** スタンプセット内のインデックス（0 始まり） */
  index: number;
  /** プレビュー表示用の base64 data URL */
  dataUrl: string;
  /** バックエンド側の一時ファイルパス */
  tempFilePath: string;
  /** 生成状態 */
  status: "pending" | "generating" | "done" | "error";
  /** エラー時のメッセージ（日本語） */
  errorMessage?: string;
}

// --- LINE 規格バリデーション ---

/** LINE 規格適合チェック結果 */
export interface ValidationResult {
  /** 全チェック通過 */
  passed: boolean;
  /** サイズ適合（スタンプ: 370×320px 以内） */
  sizeOk: boolean;
  /** フォーマット適合（透過 PNG） */
  formatOk: boolean;
  /** ファイルサイズ適合（1MB 以下） */
  fileSizeOk: boolean;
  /** 圧縮最大でも 1MB を超過（調整不可） */
  fileSizeExceeded: boolean;
  /** バリデーション詳細メッセージ */
  details: string;
}

// --- スタンプセット ---

/** LINE 規格変換済みの個別スタンプ画像（3 種類セット） */
export interface StampImage {
  /** スタンプ画像パス（W370×H320px 以内、透過 PNG） */
  stampPath: string;
  /** メイン画像パス（W240×H240px、PNG） */
  mainImagePath: string;
  /** サムネイル画像パス（W96×H74px、PNG） */
  thumbnailPath: string;
  /** LINE 規格バリデーション結果 */
  validationResult: ValidationResult;
}

/** アップロード用のスタンプセット */
export interface StampSet {
  /** スタンプセットタイトル（1〜40 文字） */
  title: string;
  /** スタンプセット説明（0〜160 文字） */
  description: string;
  /** スタンプ画像一覧 */
  images: StampImage[];
  /** LINE 規格バリデーション全通過フラグ（アップロードボタン活性制御に使用） */
  isValidForUpload: boolean;
}

// --- アップロード ---

/** LINE Creators Market アップロード結果 */
export interface UploadResult {
  /** アップロード成功フラグ */
  success: boolean;
  /** LINE から返された申請 ID */
  applicationId?: string;
  /** アップロードステータス文字列 */
  status?: string;
  /** エラー種別 */
  errorType?: "network" | "auth" | "validation" | "unknown";
  /** 自動リトライ回数 */
  retryCount: number;
  /** エラーメッセージ（日本語） */
  errorMessage?: string;
}

// --- 設定 ---

/**
 * アプリ設定。
 * APIキーおよび認証情報は OS Keychain に保存するため、このオブジェクトには含まない。
 */
export interface Config {
  /** 使用する AI 画像生成エンジン */
  aiEngine: "openai" | "stable_diffusion" | "midjourney";
  /** 画像出力先ディレクトリ */
  outputDirectory: string;
  /** OpenAI 画像生成モデル名（gpt-image-2.5-flare: 速度優先 / gpt-image-2.5-sunburst: 品質優先） */
  openaiModel: "gpt-image-2.5-flare" | "gpt-image-2.5-sunburst";
  /** Stable Diffusion WebUI エンドポイント URL */
  sdEndpoint: string;
}

// --- プロンプト履歴 ---

/** プロンプト履歴エントリ（最大 20 件・新しい順） */
export interface PromptHistory {
  /** 一意 ID */
  id: string;
  /** プロンプトテキスト */
  text: string;
  /** 作成日時（ISO 8601） */
  createdAt: string;
}

// --- ログ ---

/** ログエントリ */
export interface LogEntry {
  /** タイムスタンプ（ISO 8601） */
  timestamp: string;
  /** ログレベル */
  level: "INFO" | "WARN" | "ERROR";
  /** モジュール名 */
  module: string;
  /** ログメッセージ */
  message: string;
}

// --- バリデーションエラー ---

/** バリデーション関数が返すエラー情報 */
export interface ValidationError {
  /** エラーフィールド名 */
  field: string;
  /** ユーザー向けエラーメッセージ（日本語） */
  message: string;
}
