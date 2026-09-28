"""
ImageGeneratorService — AI 画像生成エンジンへの統一インターフェース（Adapter パターン）

複数の AI 画像生成エンジン（OpenAI gpt-image-2.5 / Stable Diffusion / Midjourney）を共通の
ImageGeneratorAdapter 抽象基底クラスで抽象化し、上位層からはエンジン差異を
意識せずに画像生成を行えるようにする（tech.md: すべてのアダプタは共通の
ImageGeneratorAdapter 抽象基底クラスを実装する）。

主な方針:
  - 各アダプタは generate を async generator として実装し、1 枚あたり 180 秒の
    タイムアウトを組み込む（Requirements 2.10）
  - タイムアウトまたは API エラー時は GenerationError（error_type を含む）を
    GenerationProgress.error に載せて通知し、生成済み画像は破棄しない
    （Requirements 2.8）。呼び出し側はこの error_type を用いて日本語メッセージを
    表示する
  - APIキー・認証情報は ConfigService 経由で OS Keychain から取得する。
    平文でハードコードせず、ログにも出力しない（tech.md セキュリティルール）

structure.md の規約に従い、本サービス・各アダプタはステートレスとする
（1 回インスタンス化して注入する。グローバルなミュータブル状態を持たない）。
ユーザー向けメッセージはすべて日本語で記述する（product.md）。
"""

from __future__ import annotations

import asyncio
import base64
import os
import tempfile
from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

import httpx

from backend.models import (
    GeneratedImage,
    GenerationError,
    GenerationProgress,
    GenerationRequest,
)
from backend.services.config_service import ConfigService

# 1 枚あたりの生成タイムアウト（秒）。Requirements 2.10 に基づく。
DEFAULT_TIMEOUT_SECONDS = 180


# ---------------------------------------------------------------------------
# 例外型（呼び出し側がエラー種別を判別して日本語メッセージを表示するために使う）
# ---------------------------------------------------------------------------


class GenerationTimeoutError(Exception):
    """1 枚あたりの生成が制限時間内に完了しなかった場合に送出する。"""


class GenerationAPIError(Exception):
    """AI エンジンとの通信で API エラーが発生した場合に送出する。"""


# ---------------------------------------------------------------------------
# エラー種別を表す定数（GenerationError.error_type に対応）
# ---------------------------------------------------------------------------

ERROR_TIMEOUT = "timeout"
ERROR_API = "api_error"
ERROR_UNKNOWN = "unknown"

# エラー種別ごとのユーザー向け日本語メッセージ（Requirements 2.8, 2.10）
_ERROR_MESSAGES = {
    ERROR_TIMEOUT: "画像 {index} の生成がタイムアウトしました（{timeout}秒以内に完了しませんでした）。",
    ERROR_API: "画像 {index} の生成中にAPIエラーが発生しました。しばらく待ってから再試行してください。",
    ERROR_UNKNOWN: "画像 {index} の生成中に予期しないエラーが発生しました。",
}


def _build_error(
    index: int, error_type: str, timeout: int, detail: Optional[str] = None
) -> GenerationError:
    """エラー種別に応じた日本語メッセージ付きの GenerationError を生成する。

    detail が渡された場合は、原因の特定に役立つ詳細（例外メッセージ等）を末尾に付与する。
    詳細は呼び出し側でAPIキー等を含めないようにすること。
    """
    template = _ERROR_MESSAGES.get(error_type, _ERROR_MESSAGES[ERROR_UNKNOWN])
    message = template.format(index=index, timeout=timeout)
    if detail:
        message = f"{message}（詳細: {detail}）"
    return GenerationError(index=index, error_type=error_type, message=message)


# ---------------------------------------------------------------------------
# 抽象基底クラス
# ---------------------------------------------------------------------------


class ImageGeneratorAdapter(ABC):
    """
    AI 画像生成エンジンに対する共通アダプタ。

    各エンジン向けの具象アダプタ（OpenAIImageAdapter / StableDiffusionAdapter /
    MidjourneyAdapter）はこのクラスを継承し、_generate_one を実装する。
    generate() の枠組み（枚数ループ・タイムアウト・エラー種別への変換）は
    基底クラスで共通化する。
    """

    #: このアダプタが使用する AI エンジン識別子（'openai' | 'stable_diffusion' | 'midjourney'）
    engine_name: str = ""

    def __init__(self, config_service: Optional[ConfigService] = None) -> None:
        # APIキーは ConfigService 経由で OS Keychain から取得する。
        # アダプタ自身は認証情報値を保持しない（tech.md セキュリティルール）。
        self._config = config_service or ConfigService()

    # ------------------------------------------------------------------
    # 具象アダプタが実装するフック
    # ------------------------------------------------------------------

    @abstractmethod
    async def _generate_one(
        self,
        prompt: str,
        style: Optional[str],
        index: int,
        model: Optional[str] = None,
        quality: Optional[str] = None,
    ) -> str:
        """
        1 枚の画像を生成し、生成された画像の一時ファイルパスを返す。

        具象アダプタはここで各エンジンの API 呼び出し（OpenAI gpt-image-2.5 / SD / Midjourney）を
        実装する。API エラー時は GenerationAPIError を送出すること。

        Args:
            prompt: 生成プロンプト
            style:  生成スタイル（未選択は None）
            index:  バッチ内の画像インデックス

        Returns:
            生成された画像の一時ファイルパス
        """
        raise NotImplementedError

    # ------------------------------------------------------------------
    # 共通の generate 実装（async generator）
    # ------------------------------------------------------------------

    async def generate(
        self,
        prompt: str,
        style: Optional[str],
        count: int,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        model: Optional[str] = None,
        quality: Optional[str] = None,
    ) -> AsyncIterator[GenerationProgress]:
        """
        指定枚数の画像を順次生成し、1 枚ごとに進捗を yield する。

        各画像の生成は timeout_seconds でタイムアウトし、タイムアウトや
        API エラーが発生しても生成済みの進捗は破棄せず、エラー情報を載せた
        GenerationProgress を yield して次の画像へ継続する（Requirements 2.8, 2.10）。

        Args:
            prompt:          生成プロンプト
            style:           生成スタイル（未選択は None）
            count:           生成枚数
            timeout_seconds: 1 枚あたりのタイムアウト秒数（デフォルト 180 秒）

        Yields:
            GenerationProgress: 各画像の生成完了・エラーごとの進捗
        """
        completed = 0
        for index in range(count):
            error: Optional[GenerationError] = None
            latest_path: Optional[str] = None

            try:
                latest_path = await asyncio.wait_for(
                    self._generate_one(prompt, style, index, model, quality),
                    timeout=timeout_seconds,
                )
            except asyncio.TimeoutError:
                error = _build_error(index, ERROR_TIMEOUT, timeout_seconds)
            except GenerationAPIError as exc:
                # アダプタが付与した詳細（status・OpenAI の理由など。APIキー値は含まない）を保持する
                error = _build_error(index, ERROR_API, timeout_seconds, detail=str(exc))
            except Exception as exc:  # noqa: BLE001 - 想定外エラーも種別化して継続する
                error = _build_error(
                    index, ERROR_UNKNOWN, timeout_seconds, detail=str(exc)
                )

            data_url: Optional[str] = None
            if error is None:
                completed += 1
                # フロントがプレビュー表示に使えるよう base64 data URL を生成する。
                # 一時ファイルの読み込みに失敗した場合はエラー扱いにして継続する。
                try:
                    data_url = self._to_data_url(latest_path)
                except OSError as exc:
                    completed -= 1
                    latest_path = None
                    error = _build_error(
                        index, ERROR_UNKNOWN, timeout_seconds, detail=str(exc)
                    )

            yield GenerationProgress(
                completed=completed,
                total=count,
                latest_image_path=latest_path,
                error=error,
                index=index,
                data_url=data_url,
            )

    # ------------------------------------------------------------------
    # 共通ユーティリティ
    # ------------------------------------------------------------------

    def _require_credential(self, key: str) -> str:
        """
        OS Keychain から認証情報を取得する。未設定なら GenerationAPIError を送出する。

        取得した値そのものはログや例外メッセージに含めない（tech.md セキュリティルール）。

        Args:
            key: Keychain 上の認証情報キー（例: "openai_api_key"）

        Returns:
            取得した認証情報の値
        """
        value = self._config.get_credential(key)
        if not value:
            # 値ではなくキー名のみをメッセージに含める（値は決して出力しない）
            raise GenerationAPIError(
                f"認証情報が設定されていません（{key}）。設定画面でAPIキーを登録してください。"
            )
        return value

    @staticmethod
    def _new_temp_path(engine: str, index: int) -> str:
        """生成画像を書き出すための一時ファイルパスを生成する。"""
        fd, path = tempfile.mkstemp(
            prefix=f"lsg_{engine}_{index}_", suffix=".png"
        )
        os.close(fd)
        return path

    @staticmethod
    def _to_data_url(path: Optional[str]) -> Optional[str]:
        """一時ファイルの PNG を読み込み、base64 data URL に変換する。

        フロントエンド（Electron レンダラー）はローカルパスを直接 <img src> で
        読み込めないため、プレビュー表示用に data URL を生成する。
        path が None の場合は None を返す。読み込み失敗時は OSError を送出する。
        """
        if not path:
            return None
        with open(path, "rb") as fp:
            encoded = base64.b64encode(fp.read()).decode("ascii")
        return f"data:image/png;base64,{encoded}"


# ---------------------------------------------------------------------------
# 具象アダプタ
# ---------------------------------------------------------------------------


class OpenAIImageAdapter(ImageGeneratorAdapter):
    """
    OpenAI gpt-image-2.5（OpenAI Images API）向けアダプタ。

    モデルは Config の openai_model（'gpt-image-2.5-flare' / 'gpt-image-2.5-sunburst'、
    デフォルト 'gpt-image-2.5-flare'）で切り替える。LINEスタンプは透過必須のため、
    background='transparent' + output_format='png' を指定して透過PNGを直接取得する
    （transparent 使用時は output_format を png/webp にする必要がある）。生成後の
    LINE規格変換（サイズ・ファイルサイズ・アスペクト比）は ImageProcessorService に委ねる。

    APIキーは OS Keychain の "openai_api_key" から取得する（値はログ・例外・Config に
    含めない。tech.md セキュリティルール）。
    """

    engine_name = "openai"
    # フロントエンド（ConfigPanel の CREDENTIAL_KEYS.aiApiKey）が保存するキー名と一致させる。
    # AIエンジン共通の APIキーとして OS Keychain に "ai_api_key" で保存される。
    CREDENTIAL_KEY = "ai_api_key"
    DEFAULT_MODEL = "gpt-image-2.5-flare"
    DEFAULT_QUALITY = "auto"

    #: gpt-image-2.5 の生成パラメータ（透過PNG・生成サイズ）
    BACKGROUND = "transparent"
    OUTPUT_FORMAT = "png"
    IMAGE_SIZE = "1024x1024"

    #: OpenAI Images API エンドポイント
    API_URL = "https://api.openai.com/v1/images/generations"
    #: 1 リクエストあたりの HTTP タイムアウト（秒）。generate() 側の 180 秒より短く設定する。
    _request_timeout = 150.0

    async def _generate_one(
        self,
        prompt: str,
        style: Optional[str],
        index: int,
        model: Optional[str] = None,
        quality: Optional[str] = None,
    ) -> str:
        # APIキーの存在確認（値はログ・例外に含めない）
        api_key = self._require_credential(self.CREDENTIAL_KEY)
        config = self._config.load()
        selected_model = model or config.openai_model or self.DEFAULT_MODEL
        selected_quality = quality or config.openai_quality or self.DEFAULT_QUALITY

        image_bytes = await self._call_openai_api(
            api_key,
            selected_model,
            selected_quality,
            prompt,
            style,
            index,
        )

        path = self._new_temp_path(self.engine_name, index)
        with open(path, "wb") as fp:
            fp.write(image_bytes)
        return path

    async def _call_openai_api(
        self,
        api_key: str,
        model: str,
        quality: str,
        prompt: str,
        style: Optional[str],
        index: int,
    ) -> bytes:
        """
        OpenAI Images API（POST /v1/images/generations）を gpt-image-2.5 で呼び出し、
        画像バイト列を取得する。

        リクエストには model（gpt-image-2.5-flare / -sunburst）・prompt・
        background='transparent'・output_format='png'・size='1024x1024' を指定する。
        APIキーは Authorization ヘッダにのみ使用し、ログ・例外には含めない。

        テストではこのメソッドをモックに差し替える（外部サービスへの実通信は行わない）。
        API エラー時は GenerationAPIError を送出すること。
        """
        # style が指定されていればプロンプトへ反映する（未指定はそのまま）
        full_prompt = f"{prompt}（スタイル: {style}）" if style else prompt

        payload = {
            "model": model,
            "prompt": full_prompt,
            "n": 1,
            "size": self.IMAGE_SIZE,
            "quality": quality,
            "background": self.BACKGROUND,
            "output_format": self.OUTPUT_FORMAT,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self._request_timeout) as client:
                response = await client.post(
                    self.API_URL, json=payload, headers=headers
                )
        except httpx.HTTPError as exc:
            # ネットワーク/タイムアウト等。APIキー値は含めない。
            raise GenerationAPIError(
                f"OpenAI API への接続に失敗しました: {type(exc).__name__}"
            ) from exc

        if response.status_code != 200:
            # エラー本文から message を取り出す（APIキーは含めない）。
            detail = self._extract_error_message(response)
            raise GenerationAPIError(
                f"OpenAI API がエラーを返しました（status {response.status_code}）: {detail}"
            )

        try:
            data = response.json()
            b64 = data["data"][0]["b64_json"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise GenerationAPIError(
                "OpenAI API のレスポンス形式が想定と異なります。"
            ) from exc

        try:
            return base64.b64decode(b64)
        except (ValueError, TypeError) as exc:
            raise GenerationAPIError(
                "OpenAI API が返した画像データの復号に失敗しました。"
            ) from exc

    @staticmethod
    def _extract_error_message(response: "httpx.Response") -> str:
        """エラーレスポンスから安全に message を取り出す（APIキー等は含めない）。"""
        try:
            body = response.json()
            if isinstance(body, dict):
                err = body.get("error")
                if isinstance(err, dict) and isinstance(err.get("message"), str):
                    return err["message"]
        except ValueError:
            pass
        return "詳細不明のエラーです。"


class StableDiffusionAdapter(ImageGeneratorAdapter):
    """
    Stable Diffusion（ローカル WebUI エンドポイント）向けアダプタ。

    エンドポイント URL は Config の sd_endpoint から取得する。ローカル WebUI の
    ため通常 APIキーは不要だが、必要な場合は Keychain から取得する。
    """

    engine_name = "stable_diffusion"

    async def _generate_one(
        self,
        prompt: str,
        style: Optional[str],
        index: int,
        model: Optional[str] = None,
        quality: Optional[str] = None,
    ) -> str:
        endpoint = self._config.load().sd_endpoint
        if not endpoint:
            raise GenerationAPIError(
                "Stable Diffusion のエンドポイントが設定されていません。設定画面で登録してください。"
            )

        image_bytes = await self._call_sd_api(endpoint, prompt, style, index)

        path = self._new_temp_path(self.engine_name, index)
        with open(path, "wb") as fp:
            fp.write(image_bytes)
        return path

    async def _call_sd_api(
        self, endpoint: str, prompt: str, style: Optional[str], index: int
    ) -> bytes:
        """
        Stable Diffusion WebUI のローカルエンドポイントを呼び出して画像バイト列を取得する。

        実際の HTTP 呼び出しはここで httpx を用いて実装する。テストではこの
        メソッドをモックに差し替える。API エラー時は GenerationAPIError を送出すること。
        """
        raise NotImplementedError(
            "Stable Diffusion API 呼び出しは未実装です（テストではモックに差し替えてください）。"
        )


class MidjourneyAdapter(ImageGeneratorAdapter):
    """
    Midjourney（API）向けアダプタ。

    APIキーは OS Keychain の "midjourney_api_key" から取得する。
    """

    engine_name = "midjourney"
    CREDENTIAL_KEY = "midjourney_api_key"

    async def _generate_one(
        self,
        prompt: str,
        style: Optional[str],
        index: int,
        model: Optional[str] = None,
        quality: Optional[str] = None,
    ) -> str:
        api_key = self._require_credential(self.CREDENTIAL_KEY)

        image_bytes = await self._call_midjourney_api(api_key, prompt, style, index)

        path = self._new_temp_path(self.engine_name, index)
        with open(path, "wb") as fp:
            fp.write(image_bytes)
        return path

    async def _call_midjourney_api(
        self, api_key: str, prompt: str, style: Optional[str], index: int
    ) -> bytes:
        """
        Midjourney API を呼び出して画像バイト列を取得する。

        実際の HTTP 呼び出しはここで httpx を用いて実装する。テストではこの
        メソッドをモックに差し替える。API エラー時は GenerationAPIError を送出すること。
        """
        raise NotImplementedError(
            "Midjourney API 呼び出しは未実装です（テストではモックに差し替えてください）。"
        )


# ---------------------------------------------------------------------------
# サービス
# ---------------------------------------------------------------------------


class ImageGeneratorService:
    """
    アダプタを注入して画像生成を行うステートレスなサービス（structure.md）。

    上位層（FastAPI ルーター）はエンジン種別に応じたアダプタを注入し、
    generate_batch / generate_single を通じて画像生成を実行する。
    """

    def __init__(self, adapter: ImageGeneratorAdapter) -> None:
        self._adapter = adapter

    async def generate_batch(
        self, request: GenerationRequest
    ) -> AsyncIterator[GenerationProgress]:
        """
        リクエストの枚数分を一括生成し、進捗を逐次 yield する（Requirements 2.1）。

        各画像には 180 秒のタイムアウトが適用される（Requirements 2.10）。
        エラーが発生しても他画像の生成は継続する（Requirements 2.8）。

        Args:
            request: 生成リクエスト（プロンプト・枚数・スタイル・モード）

        Yields:
            GenerationProgress: 各画像の生成進捗
        """
        async for progress in self._adapter.generate(
            prompt=request.prompt,
            style=request.style,
            count=request.count,
            timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
            model=request.model,
            quality=request.quality,
        ):
            mapped_index = request.start_index + (progress.index or 0)
            mapped_error = (
                GenerationError(
                    index=mapped_index,
                    error_type=progress.error.error_type,
                    message=progress.error.message,
                )
                if progress.error is not None
                else None
            )
            yield GenerationProgress(
                completed=progress.completed,
                total=progress.total,
                latest_image_path=progress.latest_image_path,
                error=mapped_error,
                index=mapped_index,
                data_url=progress.data_url,
            )

    async def generate_single(
        self, request: GenerationRequest, index: int
    ) -> GeneratedImage:
        """
        1 枚だけ生成する（プレビュー承認モードの先頭 1 枚・個別再生成に使用）
        （Requirements 2.2, 2.9）。

        Args:
            request: 生成リクエスト（プロンプト・スタイルを使用）
            index:   生成する画像のインデックス

        Returns:
            生成結果を表す GeneratedImage（失敗時は status='error' かつ error を保持）
        """
        # count=1 で 1 回だけ生成し、その結果を GeneratedImage に変換する
        async for progress in self._adapter.generate(
            prompt=request.prompt,
            style=request.style,
            count=1,
            timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
            model=request.model,
            quality=request.quality,
        ):
            if progress.error is not None:
                # エラー情報のインデックスを呼び出し側の index に合わせる
                err = GenerationError(
                    index=index,
                    error_type=progress.error.error_type,
                    message=progress.error.message,
                )
                return GeneratedImage(
                    index=index,
                    temp_file_path=None,
                    status="error",
                    error=err,
                )
            return GeneratedImage(
                index=index,
                temp_file_path=progress.latest_image_path,
                status="done",
                error=None,
            )

        # 通常ここには到達しないが、安全のため未知エラーを返す
        return GeneratedImage(
            index=index,
            temp_file_path=None,
            status="error",
            error=_build_error(index, ERROR_UNKNOWN, DEFAULT_TIMEOUT_SECONDS),
        )
