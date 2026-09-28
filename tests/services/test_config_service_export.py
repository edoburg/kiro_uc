"""
ConfigService のプロパティベーステスト

タスク 2.2 / Property 13: Config エクスポートのセンシティブフィールド除外
export_sanitized() が返す dict には api_key・password を含むフィールドが存在しない。
外部サービス（OS Keychain / python-keyring）はモックする。

Validates: Requirements 6.5
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from backend.models import Config
from backend.services import config_service
from backend.services.config_service import ConfigService


# ---------------------------------------------------------------------------
# フィクスチャ / ヘルパ
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _mock_keyring(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    OS Keychain（python-keyring）へのアクセスをモックする。
    テストが実際の OS キーチェーンに触れないようにする。
    """
    store: dict[tuple[str, str], str] = {}

    def _set(service: str, key: str, value: str) -> None:
        store[(service, key)] = value

    def _get(service: str, key: str):
        return store.get((service, key))

    monkeypatch.setattr(config_service.keyring, "set_password", _set)
    monkeypatch.setattr(config_service.keyring, "get_password", _get)


def _make_service(tmp_dir: str) -> ConfigService:
    """一時ディレクトリ配下の config.json を使う ConfigService を生成する。"""
    service = ConfigService()
    service._config_path = Path(tmp_dir) / "config.json"
    return service


# 有効な Config を生成するストラテジ（全フィールド文字列）
_valid_config = st.builds(
    Config,
    ai_engine=st.sampled_from(["openai", "stable_diffusion", "midjourney"]),
    output_directory=st.text(max_size=60),
    openai_model=st.sampled_from(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]),
    openai_quality=st.sampled_from(["auto", "low", "medium", "high", "xhigh", "max"]),
    sd_endpoint=st.text(max_size=60),
)

# 設定ファイルに紛れ込みうるセンシティブなキー名（大文字小文字・部分一致を含む）
_sensitive_keys = st.sampled_from(
    [
        "api_key",
        "API_KEY",
        "openai_api_key",
        "password",
        "PASSWORD",
        "line_password",
        "user_password",
    ]
)


# ---------------------------------------------------------------------------
# Property 13: Config エクスポートのセンシティブフィールド除外
# ---------------------------------------------------------------------------

# Feature: line-stamp-generator, Property 13: Config エクスポートのセンシティブフィールド除外


@given(config=_valid_config)
@settings(max_examples=100)
def test_export_sanitized_excludes_sensitive_fields(config: Config) -> None:
    """
    任意の Config 状態に対して、export_sanitized() の返す dict には
    api_key・password を含むフィールドが存在しない。

    Validates: Requirements 6.5
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        service = _make_service(tmp_dir)
        service.save(config)

        exported = service.export_sanitized()

        for key in exported:
            lower = key.lower()
            assert "api_key" not in lower, f"api_key を含むキーが漏洩: {key}"
            assert "password" not in lower, f"password を含むキーが漏洩: {key}"


@given(config=_valid_config, sensitive_key=_sensitive_keys)
@settings(max_examples=100)
def test_export_sanitized_excludes_injected_sensitive_fields(
    config: Config, sensitive_key: str
) -> None:
    """
    設定ファイルに api_key・password 系のキーが直接書き込まれていても、
    export_sanitized() の返す dict からは必ず除外される。
    （認証情報が設定されているか否かに関わらず漏洩しないことを保証する）

    Validates: Requirements 6.5
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        service = _make_service(tmp_dir)

        # 正常な Config を保存したうえで、生 JSON にセンシティブキーを注入する
        service.save(config)
        config_path = Path(tmp_dir) / "config.json"
        raw = json.loads(config_path.read_text(encoding="utf-8"))
        raw[sensitive_key] = "PLACEHOLDER_should_not_leak"
        config_path.write_text(
            json.dumps(raw, ensure_ascii=False), encoding="utf-8"
        )

        exported = service.export_sanitized()

        assert sensitive_key not in exported
        for key in exported:
            lower = key.lower()
            assert "api_key" not in lower
            assert "password" not in lower
        # 値そのものが漏れていないことも確認する
        assert "PLACEHOLDER_should_not_leak" not in exported.values()
