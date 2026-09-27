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
import os
import tempfile
from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

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


def _build_error(index: int, error_type: str, timeout: int) -> GenerationError:
    """エラー種別に応じた日本語メッセージ付きの GenerationError を生成する。"""
    template = _ERROR_MESSAGES.get(error_type, _ERROR_MESSAGES[ERROR_UNKNOWN])
    message = template.format(index=index, timeout=timeout)
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
        self, prompt: str, style: Optional[str], index: int
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
                    self._generate_one(prompt, style, index),
                    timeout=timeout_seconds,
                )
            except asyncio.TimeoutError:
                error = _build_error(index, ERROR_TIMEOUT, timeout_seconds)
            except GenerationAPIError:
                error = _build_error(index, ERROR_API, timeout_seconds)
            except Exception:  # noqa: BLE001 - 想定外エラーも種別化して継続する
                error = _build_error(index, ERROR_UNKNOWN, timeout_seconds)

            if error is None:
                completed += 1

            yield GenerationProgress(
                completed=completed,
                total=count,
                latest_image_path=latest_path,
                error=error,
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
    CREDENTIAL_KEY = "openai_api_key"
    DEFAULT_MODEL = "gpt-image-2.5-flare"

    #: gpt-image-2.5 の生成パラメータ（透過PNG・生成サイズ）
    BACKGROUND = "transparent"
    OUTPUT_FORMAT = "png"
    IMAGE_SIZE = "1024x1024"

    async def _generate_one(
        self, prompt: str, style: Optional[str], index: int
    ) -> str:
        # APIキーの存在確認（値はログ・例外に含めない）
        api_key = self._require_credential(self.CREDENTIAL_KEY)
        model = self._config.load().openai_model or self.DEFAULT_MODEL

        image_bytes = await self._call_openai_api(api_key, model, prompt, style, index)

        path = self._new_temp_path(self.engine_name, index)
        with open(path, "wb") as fp:
            fp.write(image_bytes)
        return path

    async def _call_openai_api(
        self,
        api_key: str,
        model: str,
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

        実際の HTTP 呼び出しはここで httpx を用いて実装する。テストではこの
        メソッドをモックに差し替える（外部サービスへの実通信は行わない）。
        API エラー時は GenerationAPIError を送出すること。
        """
        raise NotImplementedError(
            "OpenAI gpt-image-2.5 API 呼び出しは未実装です（テストではモックに差し替えてください）。"
        )


class StableDiffusionAdapter(ImageGeneratorAdapter):
    """
    Stable Diffusion（ローカル WebUI エンドポイント）向けアダプタ。

    エンドポイント URL は Config の sd_endpoint から取得する。ローカル WebUI の
    ため通常 APIキーは不要だが、必要な場合は Keychain から取得する。
    """

    engine_name = "stable_diffusion"

    async def _generate_one(
        self, prompt: str, style: Optional[str], index: int
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
        self, prompt: str, style: Optional[str], index: int
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
        ):
            yield progress

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
