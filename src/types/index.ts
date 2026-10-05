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
export type StampTheme = "daily" | "work";
export type PreviewBackground = "checker" | "white" | "black" | "gray" | "custom";
export interface StampPlanItem {
  id: string;
  position: number;
  meaning: string;
  expression: string;
  pose: string;
  prop: string;
  /** この1枚だけに適用する補足指示（最大500文字）。 */
  additionalInstructions?: string;
  /** 将来のテンプレート選択用。保存するが画像生成APIには送らない。 */
  sourceTemplateId?: string;
  /** 未指定は旧データ互換で文字なし。 */
  textEnabled?: boolean;
  /** null/未指定は意味を使用。空文字は明示的な空欄。 */
  displayText?: string | null;
}

/** OpenAI GPT Image 2.5 の生成品質。 */
export type OpenAIImageQuality =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type OpenAIImageModel =
  | "gpt-image-2.5-flare"
  | "gpt-image-2.5-sunburst";

export interface GenerationOptions {
  model: OpenAIImageModel;
  quality: OpenAIImageQuality;
}
export interface GenerationPresetSnapshot {
  request: GenerationRequest;
  options: GenerationOptions;
}
export interface GenerationPreset extends GenerationPresetSnapshot {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
export interface GenerationPresetSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  count: StampCount;
  theme: StampTheme;
}
export interface GenerationPresetList {
  presets: GenerationPresetSummary[];
  issues: { id?: string; message: string }[];
}
export interface GenerationPresetSave {
  id?: string;
  name: string;
  snapshot: GenerationPresetSnapshot;
}

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
  theme?: StampTheme;
  items?: StampPlanItem[];
}

/** 1回のバックエンド生成処理に渡す内部要求。 */
export interface GenerationStartRequest extends Omit<GenerationRequest, "count"> {
  count: number;
  startIndex: number;
  model: OpenAIImageModel;
  quality: OpenAIImageQuality;
}

// --- 生成画像 ---

/** AI が生成した個別画像 */
export interface GeneratedImage {
  /** スタンプセット内のインデックス（0 始まり） */
  index: number;
  itemId?: string;
  generationItem?: StampPlanItem;
  /** この画像の生成に実際に使った設定。次回用条件とは独立。 */
  textSettings?: { textEnabled: boolean; displayText: string | null };
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
  /**
   * セット内で一意かつ安定した画像ID。生成項目ID（GeneratedImage.itemId）を引き継ぎ、
   * 差し替え・再変換・並び替えでも変えない。メイン／タブ画像の選択はこのIDで参照する。
   */
  id: string;
  /** 変換元画像のバックエンド側パス（再試行用） */
  sourcePath: string;
  /** スタンプ画像パス（W370×H320px 以内、透過 PNG） */
  stampPath: string;
  /** メイン画像パス（W240×H240px、PNG） */
  mainImagePath: string;
  /** サムネイル画像パス（W96×H74px、PNG） */
  thumbnailPath: string;
  /** 各画像のレンダラー表示用 data URL */
  stampPreviewUrl: string;
  mainImagePreviewUrl: string;
  thumbnailPreviewUrl: string;
  /** 変換状態 */
  processingStatus: "processing" | "done" | "error";
  /** 変換失敗時の日本語メッセージ */
  processingError?: string;
  /** LINE 規格バリデーション結果 */
  validationResult: ValidationResult;
}

/** アップロード用のスタンプセット */
export interface StampSet {
  /** スタンプセットタイトル（1〜40 文字） */
  title: string;
  /** スタンプセット説明（0〜160 文字） */
  description: string;
  /** LINE STOREに表示するクリエイター名（1〜50文字） */
  creatorName: string;
  /** 権利表記（1〜50文字） */
  copyright: string;
  /** スタンプ画像一覧 */
  images: StampImage[];
  /** メイン画像の元にする画像ID（その画像の mainImagePath を使う）。null は未選択。 */
  mainImageId: string | null;
  /** トークルームタブ画像の元にする画像ID（その画像の thumbnailPath を使う）。null は未選択。 */
  tabImageId: string | null;
  /** LINE 規格バリデーション全通過フラグ（アップロードボタン活性制御に使用） */
  isValidForUpload: boolean;
}

/** メイン画像／トークルームタブ画像の役割。 */
export type RepresentativeRole = "main" | "tab";

/**
 * 正規化前のStampSet。画像IDや選択フィールドを持たない旧データを受け付ける。
 * 選択フィールドが未指定（undefined）の場合だけ先頭の正常画像へフォールバックし、
 * null や不正なIDは指定値のまま保持する。
 */
export interface StampSetInput
  extends Omit<StampSet, "images" | "mainImageId" | "tabImageId"> {
  images: (Omit<StampImage, "id"> & { id?: string })[];
  mainImageId?: string | null;
  tabImageId?: string | null;
}

/** バックエンドの画像処理APIが返す、1画像分のLINE規格変換結果。 */
export interface ProcessedImageSet {
  stampPath: string;
  mainImagePath: string;
  thumbnailPath: string;
  validation: ValidationResult;
  stampDataUrl: string;
  mainImageDataUrl: string;
  thumbnailDataUrl: string;
}

// --- アップロード ---

/** LINE Creators Market アップロード結果 */
export interface UploadResult {
  /** アップロード成功フラグ */
  success: boolean;
  /** LINE から返された下書き管理 ID または申請 ID */
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
  openaiModel: OpenAIImageModel;
  /** OpenAI GPT Image 2.5 の生成品質 */
  openaiQuality: OpenAIImageQuality;
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
