"""
ConfigService のプロパティベーステスト

タスク 2.3 / Property 14: Config JSON ラウンドトリップ
外部サービス（OS Keychain / python-keyring）はモックする。
JSON ファイル I/O は一時ディレクトリで行い、実ホーム（~/.line-stamp-gen）には触れない。
"""

from __future__ import annotations

import tempfile
from dataclasses import asdict
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
    output_directory=st.text(max_size=200),
    openai_model=st.sampled_from(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]),
    openai_quality=st.sampled_from(["auto", "low", "medium", "high", "xhigh", "max"]),
    sd_endpoint=st.text(max_size=200),
)


# ---------------------------------------------------------------------------
# Property 14: Config JSON ラウンドトリップ
# ---------------------------------------------------------------------------

# Feature: line-stamp-generator, Property 14: Config JSON ラウンドトリップ


@given(config=_valid_config)
@settings(max_examples=100)
def test_config_json_roundtrip(config: Config) -> None:
    """
    任意の有効な Config に対して、export_sanitized() でシリアライズし
    import_from_dict() でインポートすると、元の Config と同一内容が復元される。

    Validates: Requirements 6.6
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        service = _make_service(tmp_dir)

        # 保存 → エクスポート → インポート → 再読込 のラウンドトリップ
        service.save(config)
        exported = service.export_sanitized()
        service.import_from_dict(exported)
        restored = service.load()

    assert restored == config
    assert asdict(restored) == asdict(config)
