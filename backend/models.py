"""
LINEスタンプジェネレーター バックエンドデータモデル

すべての Python データクラスはここに定義する。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


# ---------------------------------------------------------------------------
# 画像処理
# ---------------------------------------------------------------------------


@dataclass
class ValidationResult:
    """LINE 規格適合チェック結果"""

    passed: bool
    """全チェック通過フラグ"""

    size_ok: bool
    """サイズ適合（スタンプ: 370×320px 以内）"""

    format_ok: bool
    """フォーマット適合（透過 PNG）"""

    file_size_ok: bool
    """ファイルサイズ適合（1MB 以下）"""

    file_size_exceeded: bool
    """圧縮最大でも 1MB 超過（調整不可）"""

    details: str
    """バリデーション詳細メッセージ"""


@dataclass
class ProcessedImageSet:
    """LINE 規格変換済みの画像セット（1 スタンプにつき 3 種類）"""

    stamp_path: str
    """スタンプ画像パス（W370×H320px 以内、透過 PNG）"""

    main_image_path: str
    """メイン画像パス（W240×H240px、PNG）"""

    thumbnail_path: str
    """サムネイル画像パス（W96×H74px、PNG）"""

    validation: ValidationResult
    """LINE 規格バリデーション結果"""

    stamp_data_url: str = ""
    """スタンプ画像のプレビュー用 data URL"""

    main_image_data_url: str = ""
    """メイン画像のプレビュー用 data URL"""

    thumbnail_data_url: str = ""
    """サムネイル画像のプレビュー用 data URL"""


# ---------------------------------------------------------------------------
# ZIPエクスポート
# ---------------------------------------------------------------------------


@dataclass
class ExportImage:
    """ZIPへ格納する1スタンプ分の変換済み画像パス。"""

    stamp_path: str
    main_image_path: str
    thumbnail_path: str


@dataclass
class ExportStampSet:
    """ZIPエクスポート用のスタンプセット。"""

    title: str
    description: str
    images: list[ExportImage]


@dataclass
class ExportResult:
    """ZIPエクスポート結果。"""

    zip_path: str
    file_name: str
    image_count: int


# ---------------------------------------------------------------------------
# 画像生成
# ---------------------------------------------------------------------------


@dataclass
class GenerationError:
    """AI 画像生成エラー情報"""

    index: int
    """エラーが発生した画像インデックス"""

    error_type: str
    """エラー種別 ('timeout' | 'api_error' | 'unknown')"""

    message: str
    """エラーメッセージ（日本語）"""


@dataclass
class GenerationProgress:
    """AI 画像生成進捗情報"""

    completed: int
    """生成完了枚数"""

    total: int
    """生成予定の総枚数"""

    latest_image_path: Optional[str]
    """直近で生成された画像の一時ファイルパス"""

    error: Optional[GenerationError]
    """エラー情報（エラーなしの場合 None）"""

    index: Optional[int] = None
    """直近で生成された画像のバッチ内インデックス（0 始まり。エラー時も設定する）"""

    data_url: Optional[str] = None
    """直近で生成された画像の base64 data URL（例: 'data:image/png;base64,...'）。
    フロントエンドがプレビュー表示に用いる。生成失敗時は None。"""


# 有効なスタンプ生成枚数（Requirements 1.4）
VALID_STAMP_COUNTS = (8, 16, 24, 32, 40)


@dataclass
class GenerationRequest:
    """
    AI 画像生成リクエスト（フロントエンドの GenerationRequest に対応）。

    APIキーはこのリクエストには含まれない。アダプタが ConfigService 経由で
    OS Keychain から取得する（tech.md セキュリティルール）。
    """

    prompt: str
    """生成条件のプロンプト（日本語または英語）"""

    count: int = 8
    """生成枚数（8 / 16 / 24 / 32 / 40 のいずれか、デフォルト 8）"""

    style: Optional[str] = None
    """生成スタイル（'かわいい' | 'クール' | 'ゆるい' | 'リアル'）。未選択は None"""

    mode: str = "batch"
    """生成モード（'batch' | 'preview_approval'）"""


@dataclass
class GeneratedImage:
    """
    AI が生成した 1 枚の画像情報（フロントエンドの GeneratedImage に対応）。
    """

    index: int
    """バッチ内での画像インデックス（0 始まり）"""

    temp_file_path: Optional[str]
    """バックエンド側の一時ファイルパス（生成失敗時は None）"""

    status: str = "done"
    """状態 ('pending' | 'generating' | 'done' | 'error')"""

    error: Optional[GenerationError] = None
    """生成失敗時のエラー情報（成功時は None）"""


# ---------------------------------------------------------------------------
# アップロード
# ---------------------------------------------------------------------------


@dataclass
class UploadProgress:
    """
    LINE Creators Market アップロード進捗情報。

    on_progress コールバックで 1 秒以内の間隔で通知する（Requirements 5.2）。
    """

    phase: str
    """現在のフェーズ ('login' | 'uploading' | 'saving' | 'submitting' | 'done' | 'retrying')"""

    completed: int
    """完了したステップ数（またはアップロード済み画像枚数）"""

    total: int
    """全体のステップ数（またはアップロード予定の画像枚数）"""

    message: str
    """進捗メッセージ（日本語）"""


@dataclass
class UploadResult:
    """LINE Creators Market アップロード結果"""

    success: bool
    """アップロード成功フラグ"""

    application_id: Optional[str]
    """LINE から返された申請 ID"""

    status: Optional[str]
    """アップロードステータス文字列"""

    error_type: Optional[str]
    """エラー種別 ('network' | 'auth' | 'validation' | 'unknown')"""

    retry_count: int
    """自動リトライ回数"""

    error_message: Optional[str]
    """エラーメッセージ（日本語）"""


# ---------------------------------------------------------------------------
# ログ
# ---------------------------------------------------------------------------


@dataclass
class LogEntry:
    """ログエントリ"""

    timestamp: str
    """タイムスタンプ（ISO 8601）"""

    level: str
    """ログレベル ('INFO' | 'WARN' | 'ERROR')"""

    module: str
    """モジュール名"""

    message: str
    """ログメッセージ"""


# ---------------------------------------------------------------------------
# 認証情報
# ---------------------------------------------------------------------------


@dataclass
class LineCredentials:
    """LINE Creators Market 認証情報（OS Keychain から取得した値を保持する）"""

    email: str
    """メールアドレス"""

    password: str
    """パスワード（OS Keychain から取得したもの。平文ファイルには保存しない）"""


# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------


@dataclass
class Config:
    """
    アプリ設定。
    APIキーおよび認証情報は OS Keychain に保存するため、このオブジェクトには含まない。
    永続化先: ~/.line-stamp-gen/config.json
    """

    ai_engine: str = "openai"
    """使用する AI 画像生成エンジン ('openai' | 'stable_diffusion' | 'midjourney')"""

    output_directory: str = ""
    """画像出力先ディレクトリ"""

    openai_model: str = "gpt-image-2.5-flare"
    """OpenAI 画像生成モデル名 ('gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst')"""

    sd_endpoint: str = ""
    """Stable Diffusion WebUI エンドポイント URL"""
