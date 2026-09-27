"""
LINEスタンプジェネレーター FastAPI バックエンド

Electron メインプロセスから子プロセスとして起動される。
ポート: 8765 (localhost のみ)

このモジュールは各サービス（ConfigService / LogService / ImageProcessorService /
ImageGeneratorService / UploaderService）を 1 回だけインスタンス化し（ステートレス・
単一インスタンス注入、structure.md の規約）、HTTP エンドポイントへ配線する。

エンドポイント一覧:
  - POST /generate        AI 画像生成（SSE ストリームで進捗配信）
  - POST /process         LINE 規格変換
  - POST /export          変換済みスタンプセットのZIPエクスポート
  - POST /upload          LINE Creators Market アップロード（SSE ストリームで進捗配信）
  - GET  /config          Config の読み取り
  - POST /config          Config の保存
  - GET  /config/export   センシティブフィールドを除いた Config のエクスポート
  - POST /config/import   Config のインポート（スキーマ検証後に上書き）
  - POST /config/credential          クレデンシャルを OS Keychain に保存
  - GET  /config/credential/{key}    クレデンシャルの設定有無を確認（値は返さない）
  - GET  /logs            ログ取得・フィルタリング（最大 1000 件）

セキュリティ方針（tech.md）:
  - /config/export は export_sanitized() を使い、api_key / password を絶対に返さない
  - クレデンシャルは ConfigService.save_credential 経由で OS Keychain にのみ保存し、
    config.json やログ、レスポンスに平文の値を出力しない
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict
from datetime import datetime
from typing import Any, AsyncIterator, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.models import (
    Config,
    ExportImage,
    ExportStampSet,
    GenerationRequest as GenerationRequestModel,
    LineCredentials,
    UploadProgress,
)
from backend.api_contracts import (
    ConfigPayload,
    ExportRequestPayload,
    ProcessRequestPayload,
    UploadRequestPayload,
    UploadStampSetPayload,
    to_api_payload,
)
from backend.services.config_service import ConfigService
from backend.services.image_generator_service import (
    ImageGeneratorAdapter,
    ImageGeneratorService,
    MidjourneyAdapter,
    OpenAIImageAdapter,
    StableDiffusionAdapter,
)
from backend.services.image_processor_service import ImageProcessorService
from backend.services.log_service import LogLevel, LogService
from backend.services.stamp_export_service import StampExportService
from backend.services.uploader_service import UploaderService

app = FastAPI(
    title="LINEスタンプジェネレーター API",
    description="LINE スタンプ生成・変換・アップロード用 FastAPI バックエンド",
    version="1.0.0",
)

# localhost からの Electron レンダラーアクセスのみ許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "app://.", "http://localhost"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# サービスの単一インスタンス（ステートレス・注入用、structure.md）
# ---------------------------------------------------------------------------

config_service = ConfigService()
log_service = LogService()
image_processor_service = ImageProcessorService()
stamp_export_service = StampExportService()
uploader_service = UploaderService()

# AI エンジン識別子 -> アダプタクラスのマッピング
_ADAPTER_BY_ENGINE: dict[str, type[ImageGeneratorAdapter]] = {
    "openai": OpenAIImageAdapter,
    "stable_diffusion": StableDiffusionAdapter,
    "midjourney": MidjourneyAdapter,
}


def _build_generator_service(engine: str) -> ImageGeneratorService:
    """Config の AI エンジン種別に応じた ImageGeneratorService を組み立てる。

    アダプタは ConfigService を共有し、APIキーは OS Keychain 経由で取得する
    （tech.md セキュリティルール）。
    """
    adapter_cls = _ADAPTER_BY_ENGINE.get(engine, OpenAIImageAdapter)
    adapter = adapter_cls(config_service=config_service)
    return ImageGeneratorService(adapter)


# ---------------------------------------------------------------------------
# SSE ユーティリティ
# ---------------------------------------------------------------------------


def _sse_event(data: Any, event: Optional[str] = None) -> str:
    """dict / dataclass を Server-Sent Events の 1 メッセージにフレーミングする。

    sse-starlette は依存関係に含まれないため、text/event-stream の手動フレーミングで
    実装する（"event:" / "data:" 行 + 空行区切り）。
    """
    payload = to_api_payload(data)
    body = json.dumps(payload, ensure_ascii=False)
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {body}\n\n"


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


# ---------------------------------------------------------------------------
# ヘルスチェック
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    """メインプロセスが起動確認に使用するエンドポイント"""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# 設定エンドポイント
# ---------------------------------------------------------------------------


class ConfigRequest(ConfigPayload):
    """レンダラーから受け取る完全なConfig（公開形式はcamelCase）。"""


class CredentialRequest(BaseModel):
    key: str
    value: str


@app.get("/config")
async def get_config() -> dict:
    """現在の設定を取得する（Requirements 6.1）。

    Config には認証情報は含まれない（OS Keychain に保存されるため）。
    """
    try:
        config = config_service.load()
    except Exception as exc:  # noqa: BLE001
        log_service.log(LogLevel.ERROR, "main.get_config", str(exc))
        raise HTTPException(
            status_code=500,
            detail="設定の読み込みに失敗しました。",
        ) from exc
    return to_api_payload(config)


@app.post("/config")
async def save_config(config: ConfigRequest) -> dict[str, str]:
    """設定を保存する（Requirements 6.4）。

    認証情報は含まないため、そのまま config.json に保存される。
    """
    try:
        config_service.save(
            Config(
                ai_engine=config.ai_engine,
                output_directory=config.output_directory,
                openai_model=config.openai_model,
                sd_endpoint=config.sd_endpoint,
            )
        )
    except Exception as exc:  # noqa: BLE001
        log_service.log(LogLevel.ERROR, "main.save_config", str(exc))
        raise HTTPException(
            status_code=500,
            detail="設定の保存に失敗しました。",
        ) from exc
    log_service.log(LogLevel.INFO, "main.save_config", "設定を保存しました。")
    return {"status": "ok", "message": "設定を保存しました。"}


@app.get("/config/export")
async def export_config() -> dict:
    """センシティブフィールド（api_key / password）を除いた設定をエクスポートする
    （Requirements 6.5）。

    セキュリティ: export_sanitized() を必ず使用し、認証情報は決して返さない。
    """
    try:
        return to_api_payload(config_service.export_sanitized())
    except Exception as exc:  # noqa: BLE001
        log_service.log(LogLevel.ERROR, "main.export_config", str(exc))
        raise HTTPException(
            status_code=500,
            detail="設定のエクスポートに失敗しました。",
        ) from exc


@app.post("/config/import")
async def import_config(data: ConfigRequest) -> dict[str, str]:
    """設定をインポートする（スキーマ検証後のみ上書き、Requirements 6.6, 6.7）。

    スキーマ違反の場合は既存 Config を変更せず、日本語エラーメッセージを返す。
    """
    try:
        config_service.save(
            Config(
                ai_engine=data.ai_engine,
                output_directory=data.output_directory,
                openai_model=data.openai_model,
                sd_endpoint=data.sd_endpoint,
            )
        )
    except Exception as exc:  # noqa: BLE001
        log_service.log(LogLevel.ERROR, "main.import_config", str(exc))
        raise HTTPException(
            status_code=500,
            detail="設定のインポート中にエラーが発生しました。",
        ) from exc
    log_service.log(LogLevel.INFO, "main.import_config", "設定をインポートしました。")
    return {"status": "ok", "message": "設定をインポートしました。"}


@app.post("/config/credential")
async def save_credential(req: CredentialRequest) -> dict[str, str]:
    """クレデンシャルを OS Keychain に保存する（Requirements 6.2）。

    セキュリティ: 値は OS Keychain にのみ保存し、config.json / ログ / レスポンスに
    平文で出力しない（tech.md）。
    """
    try:
        config_service.save_credential(req.key, req.value)
    except Exception as exc:  # noqa: BLE001
        # 値は決してログに出さない。キー名のみ記録する。
        log_service.log(
            LogLevel.ERROR,
            "main.save_credential",
            f"クレデンシャルの保存に失敗しました（key={req.key}）。",
        )
        raise HTTPException(
            status_code=500,
            detail="認証情報の保存に失敗しました。",
        ) from exc
    # 値は記録しない（キー名のみ）
    log_service.log(
        LogLevel.INFO,
        "main.save_credential",
        f"認証情報を保存しました（key={req.key}）。",
    )
    return {"status": "ok", "key": req.key}


@app.get("/config/credential/{key}")
async def get_credential_status(key: str) -> dict:
    """クレデンシャルが OS Keychain に設定されているかどうかを返す。

    セキュリティ: 値そのものは返さず、設定済みか否か（configured）のみ返す（tech.md）。
    """
    try:
        value = config_service.get_credential(key)
    except Exception as exc:  # noqa: BLE001
        log_service.log(
            LogLevel.ERROR,
            "main.get_credential_status",
            f"クレデンシャルの取得に失敗しました（key={key}）。",
        )
        raise HTTPException(
            status_code=500,
            detail="認証情報の確認に失敗しました。",
        ) from exc
    return {"key": key, "configured": bool(value)}


# ---------------------------------------------------------------------------
# 画像生成エンドポイント（SSE）
# ---------------------------------------------------------------------------


class GenerateRequest(BaseModel):
    prompt: str
    count: int = 8
    style: str | None = None
    mode: str = "batch"


@app.post("/generate")
async def generate_images(request: GenerateRequest) -> StreamingResponse:
    """AI 画像生成リクエストを処理し、SSE ストリームで進捗を配信する
    （Requirements 2.5）。

    Config の ai_engine に応じたアダプタを選択し、generate_batch の
    async generator を SSE の "progress" イベントへブリッジする。完了時に
    "done" イベント、致命的エラー時に "error" イベントを送出する。
    """
    engine = config_service.load().ai_engine
    generator_service = _build_generator_service(engine)

    gen_request = GenerationRequestModel(
        prompt=request.prompt,
        count=request.count,
        style=request.style,
        mode=request.mode,
    )

    async def event_stream() -> AsyncIterator[str]:
        log_service.log(
            LogLevel.INFO,
            "main.generate",
            f"画像生成を開始しました（engine={engine}, count={request.count}）。",
        )
        try:
            async for progress in generator_service.generate_batch(gen_request):
                # 調査用: 各画像の進捗・エラー種別をログに残す（APIキー値は含まれない）
                if progress.error is not None:
                    log_service.log(
                        LogLevel.WARN,
                        "main.generate",
                        f"画像 {progress.error.index} でエラー"
                        f"（type={progress.error.error_type}）: {progress.error.message}",
                    )
                else:
                    log_service.log(
                        LogLevel.INFO,
                        "main.generate",
                        f"画像を生成しました（{progress.completed}/{progress.total}）。",
                    )
                yield _sse_event(progress, event="progress")
            yield _sse_event({"status": "done"}, event="done")
        except Exception as exc:  # noqa: BLE001
            log_service.log(LogLevel.ERROR, "main.generate", str(exc))
            yield _sse_event(
                {
                    "status": "error",
                    "message": "画像生成中にエラーが発生しました。設定を確認して再度お試しください。",
                },
                event="error",
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


# ---------------------------------------------------------------------------
# 画像処理エンドポイント
# ---------------------------------------------------------------------------


class ProcessRequest(ProcessRequestPayload):
    """画像処理要求（公開形式は sourcePath）。"""


@app.post("/process")
async def process_image(request: ProcessRequest) -> dict:
    """LINE 規格変換を実行する（ImageProcessorService.process_image を呼び出す）。

    スタンプ・メイン・サムネイル画像を生成し、バリデーション結果を返す。
    """
    try:
        processed = await image_processor_service.process_image(request.source_path)
    except FileNotFoundError as exc:
        log_service.log(LogLevel.WARN, "main.process", str(exc))
        raise HTTPException(
            status_code=404,
            detail="入力画像が見つかりません。",
        ) from exc
    except OSError as exc:
        log_service.log(LogLevel.ERROR, "main.process", str(exc))
        raise HTTPException(
            status_code=500,
            detail="画像の変換に失敗しました。",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        log_service.log(LogLevel.ERROR, "main.process", str(exc))
        raise HTTPException(
            status_code=500,
            detail="画像の変換中に予期しないエラーが発生しました。",
        ) from exc
    return to_api_payload(processed)


# ---------------------------------------------------------------------------
# ZIPエクスポートエンドポイント
# ---------------------------------------------------------------------------


class ExportRequest(ExportRequestPayload):
    """ZIPエクスポート要求（公開形式はcamelCase）。"""


@app.post("/export")
async def export_stamp_set(request: ExportRequest) -> dict:
    """変換済みスタンプ画像一式をZIPへ保存する。"""
    stamp_set = ExportStampSet(
        title=request.stamp_set.title,
        description=request.stamp_set.description,
        images=[
            ExportImage(
                stamp_path=image.stamp_path,
                main_image_path=image.main_image_path,
                thumbnail_path=image.thumbnail_path,
            )
            for image in request.stamp_set.images
        ],
    )
    try:
        result = stamp_export_service.export(stamp_set, request.output_directory)
    except ValueError as exc:
        log_service.log(LogLevel.WARN, "main.export", str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        log_service.log(LogLevel.WARN, "main.export", str(exc))
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OSError as exc:
        log_service.log(LogLevel.ERROR, "main.export", str(exc))
        raise HTTPException(
            status_code=500,
            detail="ZIPファイルの保存に失敗しました。保存先を確認してください。",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        log_service.log(LogLevel.ERROR, "main.export", str(exc))
        raise HTTPException(
            status_code=500,
            detail="ZIPエクスポート中に予期しないエラーが発生しました。",
        ) from exc

    log_service.log(
        LogLevel.INFO,
        "main.export",
        f"ZIPをエクスポートしました（images={result.image_count}）。",
    )
    return to_api_payload(result)


# ---------------------------------------------------------------------------
# アップロードエンドポイント（SSE）
# ---------------------------------------------------------------------------


class UploadRequest(UploadRequestPayload):
    """LINEアップロード要求（公開形式はcamelCase）。"""


class _StampSetAdapter:
    """UploaderService が getattr で参照する属性を持つ軽量ラッパー。"""

    def __init__(self, model: UploadStampSetPayload) -> None:
        self.title = model.title
        self.description = model.description
        self.creator_name = model.creator_name
        self.copyright = model.copyright
        self.images = list(model.images)
        self.main_image_path = model.main_image_path
        self.thumbnail_path = model.thumbnail_path


@app.post("/upload")
async def upload_stamp_set(request: UploadRequest) -> StreamingResponse:
    """LINE Creators Market へアップロードし、SSE ストリームで進捗を配信する
    （Requirements 5.2）。

    認証情報（メールアドレス・パスワード）は OS Keychain から取得する（tech.md）。
    UploaderService.upload は同期コールバック on_progress で進捗を通知するため、
    asyncio.Queue を介して SSE イベントへブリッジする。
    """
    # 認証情報は OS Keychain から取得（値はレスポンス・ログに出力しない）
    email = config_service.get_credential(request.email_credential_key)
    password = config_service.get_credential(request.password_credential_key)

    stamp_set = _StampSetAdapter(request.stamp_set)

    async def event_stream() -> AsyncIterator[str]:
        if not email or not password:
            # 認証情報未設定: アップロードを開始しない（Requirements 5.8）
            log_service.log(
                LogLevel.WARN,
                "main.upload",
                "認証情報が未設定のためアップロードを中止しました。",
            )
            yield _sse_event(
                {
                    "status": "error",
                    "error_type": "auth",
                    "message": "認証情報が設定されていません。設定画面でLINEの認証情報を登録してください。",
                },
                event="error",
            )
            return

        credentials = LineCredentials(email=email, password=password)
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[Optional[UploadProgress]] = asyncio.Queue()

        def on_progress(progress: UploadProgress) -> None:
            # 同期コールバック → イベントループのキューへスレッドセーフに橋渡し
            loop.call_soon_threadsafe(queue.put_nowait, progress)

        async def run_upload() -> Any:
            try:
                return await uploader_service.upload(stamp_set, credentials, on_progress)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        upload_task = asyncio.create_task(run_upload())

        log_service.log(LogLevel.INFO, "main.upload", "アップロードを開始しました。")

        # 進捗をキューから取り出して SSE で配信（None が番兵）
        while True:
            progress = await queue.get()
            if progress is None:
                break
            yield _sse_event(progress, event="progress")

        result = await upload_task
        if getattr(result, "success", False):
            log_service.log(LogLevel.INFO, "main.upload", "アップロードが完了しました。")
            yield _sse_event(result, event="done")
        else:
            log_service.log(
                LogLevel.ERROR,
                "main.upload",
                f"アップロードに失敗しました（error_type={getattr(result, 'error_type', None)}）。",
            )
            yield _sse_event(result, event="error")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


# ---------------------------------------------------------------------------
# ログエンドポイント
# ---------------------------------------------------------------------------


def _parse_iso(value: Optional[str], field: str) -> Optional[datetime]:
    """ISO 8601 文字列を datetime に変換する。不正な場合は 400 を返す。"""
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"日付の形式が不正です（{field}）。ISO 8601 形式で指定してください。",
        ) from exc


@app.get("/logs")
async def get_logs(
    level: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(default=1000, ge=1, le=1000),
) -> list[dict]:
    """ログエントリを取得する（レベル・日付範囲でフィルタ、最大 1000 件）
    （Requirements 7.4, 7.6）。
    """
    log_level: Optional[LogLevel] = None
    if level is not None:
        try:
            log_level = LogLevel(level.upper())
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="ログレベルが不正です（INFO / WARN / ERROR のいずれかを指定してください）。",
            ) from exc

    df = _parse_iso(date_from, "date_from")
    dt = _parse_iso(date_to, "date_to")

    entries = log_service.get_entries(
        level=log_level,
        date_from=df,
        date_to=dt,
        limit=limit,
    )
    return [asdict(entry) for entry in entries]
