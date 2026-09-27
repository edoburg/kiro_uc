"""
ImageGeneratorService / 各アダプタのユニットテスト（pytest + unittest.mock）

対象: backend/services/image_generator_service.py
  - OpenAIImageAdapter / StableDiffusionAdapter / MidjourneyAdapter

検証内容（Requirements 2.8, 2.10）:
  - タイムアウト時: generate() が error_type == 'timeout' の GenerationError を載せた
    GenerationProgress を yield する（1 枚あたり 180 秒タイムアウト。テストでは
    tiny な timeout_seconds を渡して実 180 秒待機を避ける）
  - API エラー時: error_type == 'api_error' を yield する
  - ハッピーパス: モックした _call_*_api が成功すると latest_image_path が設定された
    完了進捗（error is None, completed が増加）を yield する
  - 認証情報未設定時: api_error を yield する
  - gpt-image-2.5 のパラメータ（background=transparent / output_format=png / モデル切替）を確認する

セキュリティ（tech.md）:
  - 外部サービス・OS Keychain は一切呼び出さず、すべてモックする
  - モック認証情報はプレースホルダ値を使用し、その値がエラーメッセージに
    漏洩しないことを確認する
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from backend.models import Config, GenerationRequest
from backend.services.image_generator_service import (
    DEFAULT_TIMEOUT_SECONDS,
    ERROR_API,
    ERROR_TIMEOUT,
    GenerationAPIError,
    ImageGeneratorService,
    MidjourneyAdapter,
    OpenAIImageAdapter,
    StableDiffusionAdapter,
)

# テスト用のプレースホルダ認証情報（実キーではない。漏洩検知にも使う）
_PLACEHOLDER_API_KEY = "sk-PLACEHOLDER-secret-should-not-leak"
_PLACEHOLDER_SD_ENDPOINT = "http://localhost:7860"


# ---------------------------------------------------------------------------
# ヘルパー: ConfigService をモックしたアダプタを生成する
# ---------------------------------------------------------------------------


def _make_config_mock(
    *,
    credential: str | None = _PLACEHOLDER_API_KEY,
    sd_endpoint: str = "",
    openai_model: str = "gpt-image-2.5-flare",
) -> MagicMock:
    """OS Keychain / 設定ファイルに触れないモック ConfigService を作る。"""
    config_mock = MagicMock()
    config_mock.get_credential.return_value = credential
    config_mock.load.return_value = Config(
        ai_engine="openai",
        output_directory="",
        openai_model=openai_model,
        sd_endpoint=sd_endpoint,
    )
    return config_mock


async def _collect(agen) -> list:
    """async generator を最後まで走らせて結果をリストに集める。"""
    return [item async for item in agen]


# ---------------------------------------------------------------------------
# OpenAIImageAdapter（gpt-image-2.5）
# ---------------------------------------------------------------------------


class TestOpenAIImageAdapter:
    async def test_happy_path_yields_done_progress_with_image_path(self):
        """_call_openai_api が成功すると latest_image_path 付きの完了進捗を yield する。"""
        adapter = OpenAIImageAdapter(config_service=_make_config_mock())

        with patch.object(
            adapter, "_call_openai_api", new=AsyncMock(return_value=b"\x89PNG-fake")
        ):
            results = await _collect(
                adapter.generate(prompt="ねこ", style="かわいい", count=2)
            )

        assert len(results) == 2
        for i, progress in enumerate(results, start=1):
            assert progress.error is None
            assert progress.total == 2
            assert progress.completed == i
            assert progress.latest_image_path is not None
            assert progress.latest_image_path.endswith(".png")

    async def test_timeout_yields_timeout_error(self):
        """_generate_one が制限時間を超えると error_type == 'timeout' を yield する。"""
        adapter = OpenAIImageAdapter(config_service=_make_config_mock())

        async def _slow_api(*args, **kwargs):
            await asyncio.sleep(10)  # tiny timeout に対して確実に超過させる
            return b"never"

        with patch.object(adapter, "_call_openai_api", new=_slow_api):
            # 実 180 秒を待たず、tiny な timeout_seconds でタイムアウトを再現
            results = await _collect(
                adapter.generate(
                    prompt="ねこ", style=None, count=1, timeout_seconds=0.01
                )
            )

        assert len(results) == 1
        error = results[0].error
        assert error is not None
        assert error.error_type == ERROR_TIMEOUT
        assert results[0].completed == 0
        assert results[0].latest_image_path is None

    async def test_api_error_yields_api_error(self):
        """_call_openai_api が GenerationAPIError を送出すると error_type == 'api_error'。"""
        adapter = OpenAIImageAdapter(config_service=_make_config_mock())

        with patch.object(
            adapter,
            "_call_openai_api",
            new=AsyncMock(side_effect=GenerationAPIError("API 呼び出し失敗")),
        ):
            results = await _collect(
                adapter.generate(prompt="ねこ", style=None, count=1)
            )

        assert len(results) == 1
        error = results[0].error
        assert error is not None
        assert error.error_type == ERROR_API
        assert results[0].completed == 0

    async def test_missing_credential_yields_api_error(self):
        """認証情報が未設定なら api_error を yield する（_call_openai_api は呼ばれない）。"""
        adapter = OpenAIImageAdapter(config_service=_make_config_mock(credential=None))

        call_api = AsyncMock(return_value=b"unused")
        with patch.object(adapter, "_call_openai_api", new=call_api):
            results = await _collect(
                adapter.generate(prompt="ねこ", style=None, count=1)
            )

        assert len(results) == 1
        assert results[0].error is not None
        assert results[0].error.error_type == ERROR_API
        call_api.assert_not_called()

    async def test_credential_value_never_leaks_into_error_message(self):
        """エラーメッセージに認証情報の値が漏洩しないこと（セキュリティ）。"""
        adapter = OpenAIImageAdapter(config_service=_make_config_mock())

        with patch.object(
            adapter,
            "_call_openai_api",
            new=AsyncMock(side_effect=GenerationAPIError("失敗")),
        ):
            results = await _collect(
                adapter.generate(prompt="ねこ", style=None, count=1)
            )

        error = results[0].error
        assert error is not None
        assert _PLACEHOLDER_API_KEY not in error.message

    async def test_uses_transparent_png_params(self):
        """gpt-image-2.5 は透過PNGパラメータ（background=transparent / output_format=png）を持つ。"""
        adapter = OpenAIImageAdapter(config_service=_make_config_mock())
        assert adapter.BACKGROUND == "transparent"
        assert adapter.OUTPUT_FORMAT == "png"
        assert adapter.engine_name == "openai"
        assert adapter.DEFAULT_MODEL == "gpt-image-2.5-flare"

    async def test_model_switch_flare_and_sunburst(self):
        """Config の openai_model が _call_openai_api に渡るモデルを切り替える。"""
        for model in ("gpt-image-2.5-flare", "gpt-image-2.5-sunburst"):
            adapter = OpenAIImageAdapter(
                config_service=_make_config_mock(openai_model=model)
            )
            call_api = AsyncMock(return_value=b"\x89PNG-fake")
            with patch.object(adapter, "_call_openai_api", new=call_api):
                await _collect(adapter.generate(prompt="ねこ", style=None, count=1))

            # _call_openai_api(api_key, model, prompt, style, index) の第 2 引数がモデル
            called_model = call_api.await_args.args[1]
            assert called_model == model


# ---------------------------------------------------------------------------
# StableDiffusionAdapter
# ---------------------------------------------------------------------------


class TestStableDiffusionAdapter:
    async def test_happy_path_yields_done_progress_with_image_path(self):
        adapter = StableDiffusionAdapter(
            config_service=_make_config_mock(sd_endpoint=_PLACEHOLDER_SD_ENDPOINT)
        )

        with patch.object(
            adapter, "_call_sd_api", new=AsyncMock(return_value=b"\x89PNG-fake")
        ):
            results = await _collect(
                adapter.generate(prompt="いぬ", style="クール", count=1)
            )

        assert len(results) == 1
        assert results[0].error is None
        assert results[0].completed == 1
        assert results[0].latest_image_path is not None
        assert results[0].latest_image_path.endswith(".png")

    async def test_timeout_yields_timeout_error(self):
        adapter = StableDiffusionAdapter(
            config_service=_make_config_mock(sd_endpoint=_PLACEHOLDER_SD_ENDPOINT)
        )

        async def _slow_api(*args, **kwargs):
            await asyncio.sleep(10)
            return b"never"

        with patch.object(adapter, "_call_sd_api", new=_slow_api):
            results = await _collect(
                adapter.generate(
                    prompt="いぬ", style=None, count=1, timeout_seconds=0.01
                )
            )

        assert results[0].error is not None
        assert results[0].error.error_type == ERROR_TIMEOUT

    async def test_api_error_yields_api_error(self):
        adapter = StableDiffusionAdapter(
            config_service=_make_config_mock(sd_endpoint=_PLACEHOLDER_SD_ENDPOINT)
        )

        with patch.object(
            adapter,
            "_call_sd_api",
            new=AsyncMock(side_effect=GenerationAPIError("SD API 失敗")),
        ):
            results = await _collect(
                adapter.generate(prompt="いぬ", style=None, count=1)
            )

        assert results[0].error is not None
        assert results[0].error.error_type == ERROR_API

    async def test_missing_endpoint_yields_api_error(self):
        """SD エンドポイント未設定は api_error を yield する（_call_sd_api は呼ばれない）。"""
        adapter = StableDiffusionAdapter(
            config_service=_make_config_mock(sd_endpoint="")
        )

        call_api = AsyncMock(return_value=b"unused")
        with patch.object(adapter, "_call_sd_api", new=call_api):
            results = await _collect(
                adapter.generate(prompt="いぬ", style=None, count=1)
            )

        assert results[0].error is not None
        assert results[0].error.error_type == ERROR_API
        call_api.assert_not_called()


# ---------------------------------------------------------------------------
# MidjourneyAdapter
# ---------------------------------------------------------------------------


class TestMidjourneyAdapter:
    async def test_happy_path_yields_done_progress_with_image_path(self):
        adapter = MidjourneyAdapter(config_service=_make_config_mock())

        with patch.object(
            adapter, "_call_midjourney_api", new=AsyncMock(return_value=b"\x89PNG-fake")
        ):
            results = await _collect(
                adapter.generate(prompt="うさぎ", style="ゆるい", count=1)
            )

        assert len(results) == 1
        assert results[0].error is None
        assert results[0].completed == 1
        assert results[0].latest_image_path is not None
        assert results[0].latest_image_path.endswith(".png")

    async def test_timeout_yields_timeout_error(self):
        adapter = MidjourneyAdapter(config_service=_make_config_mock())

        async def _slow_api(*args, **kwargs):
            await asyncio.sleep(10)
            return b"never"

        with patch.object(adapter, "_call_midjourney_api", new=_slow_api):
            results = await _collect(
                adapter.generate(
                    prompt="うさぎ", style=None, count=1, timeout_seconds=0.01
                )
            )

        assert results[0].error is not None
        assert results[0].error.error_type == ERROR_TIMEOUT

    async def test_api_error_yields_api_error(self):
        adapter = MidjourneyAdapter(config_service=_make_config_mock())

        with patch.object(
            adapter,
            "_call_midjourney_api",
            new=AsyncMock(side_effect=GenerationAPIError("MJ API 失敗")),
        ):
            results = await _collect(
                adapter.generate(prompt="うさぎ", style=None, count=1)
            )

        assert results[0].error is not None
        assert results[0].error.error_type == ERROR_API

    async def test_missing_credential_yields_api_error(self):
        adapter = MidjourneyAdapter(config_service=_make_config_mock(credential=None))

        call_api = AsyncMock(return_value=b"unused")
        with patch.object(adapter, "_call_midjourney_api", new=call_api):
            results = await _collect(
                adapter.generate(prompt="うさぎ", style=None, count=1)
            )

        assert results[0].error is not None
        assert results[0].error.error_type == ERROR_API
        call_api.assert_not_called()


# ---------------------------------------------------------------------------
# ImageGeneratorService（アダプタ注入 → generate_batch / generate_single）
# ---------------------------------------------------------------------------


class TestImageGeneratorService:
    async def test_default_timeout_is_180_seconds(self):
        """1 枚あたりのタイムアウトが 180 秒であること（Requirements 2.10）。"""
        assert DEFAULT_TIMEOUT_SECONDS == 180

    async def test_generate_batch_happy_path(self):
        adapter = OpenAIImageAdapter(config_service=_make_config_mock())
        service = ImageGeneratorService(adapter=adapter)
        request = GenerationRequest(prompt="ねこ", count=3, style="かわいい")

        with patch.object(
            adapter, "_call_openai_api", new=AsyncMock(return_value=b"\x89PNG-fake")
        ):
            results = await _collect(service.generate_batch(request))

        assert len(results) == 3
        assert all(p.error is None for p in results)
        assert results[-1].completed == 3

    async def test_generate_single_api_error_returns_error_image(self):
        adapter = OpenAIImageAdapter(config_service=_make_config_mock())
        service = ImageGeneratorService(adapter=adapter)
        request = GenerationRequest(prompt="ねこ", count=1)

        with patch.object(
            adapter,
            "_call_openai_api",
            new=AsyncMock(side_effect=GenerationAPIError("失敗")),
        ):
            image = await service.generate_single(request, index=5)

        assert image.status == "error"
        assert image.error is not None
        assert image.error.error_type == ERROR_API
        assert image.error.index == 5
        assert image.temp_file_path is None

    async def test_generate_single_happy_path_returns_done_image(self):
        adapter = OpenAIImageAdapter(config_service=_make_config_mock())
        service = ImageGeneratorService(adapter=adapter)
        request = GenerationRequest(prompt="ねこ", count=1)

        with patch.object(
            adapter, "_call_openai_api", new=AsyncMock(return_value=b"\x89PNG-fake")
        ):
            image = await service.generate_single(request, index=0)

        assert image.status == "done"
        assert image.error is None
        assert image.temp_file_path is not None
