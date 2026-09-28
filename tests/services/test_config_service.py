"""
ConfigService のプロパティベーステスト

タスク 2.4 / Property 15: 不正 Config インポート時のデータ保全
外部サービス（OS Keychain / python-keyring）はモックする。
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
from backend.services.config_service import ConfigSchema, ConfigService


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

# スキーマ検証に失敗する値（文字列以外）。ConfigSchema の各フィールドは str なので
# これらの値はいずれも ValidationError を引き起こす。
_non_string_value = st.one_of(
    st.integers(),
    st.floats(allow_nan=False, allow_infinity=False),
    st.booleans(),
    st.none(),
    st.lists(st.integers(), max_size=3),
    st.dictionaries(st.text(max_size=5), st.integers(), max_size=3),
)

# 既知の Config フィールド名（少なくとも 1 つを不正な値で埋めることで検証を失敗させる）
_config_field = st.sampled_from(
    ["ai_engine", "output_directory", "openai_model", "openai_quality", "sd_endpoint"]
)


@st.composite
def _invalid_import_dicts(draw) -> dict:
    """
    ConfigSchema のスキーマ検証に必ず失敗する dict を生成する。
    既知フィールドのうち少なくとも 1 つに文字列以外の値を設定する。
    """
    field = draw(_config_field)
    data: dict = {field: draw(_non_string_value)}
    # 追加でランダムなキー・値を混ぜても、上記フィールドが不正なため検証は失敗する
    extras = draw(
        st.dictionaries(
            st.text(min_size=1, max_size=8),
            st.one_of(st.text(max_size=10), _non_string_value),
            max_size=3,
        )
    )
    data.update(extras)
    data[field] = draw(_non_string_value)  # extras で上書きされないよう再設定
    return data


# ---------------------------------------------------------------------------
# Property 15: 不正 Config インポート時のデータ保全
# ---------------------------------------------------------------------------

# Feature: line-stamp-generator, Property 15: 不正 Config インポート時のデータ保全


@given(initial=_valid_config, invalid_data=_invalid_import_dicts())
@settings(max_examples=200)
def test_invalid_import_preserves_existing_config(
    initial: Config, invalid_data: dict
) -> None:
    """
    任意のスキーマ違反 dict に対して import_from_dict を呼び出しても、
    既存 Config は変更されず保全される（Requirements 6.7）。

    Validates: Requirements 6.7
    """
    # 前提: 生成した invalid_data は必ずスキーマ検証に失敗する
    with pytest.raises((Exception,)):
        ConfigSchema(**invalid_data)

    with tempfile.TemporaryDirectory() as tmp_dir:
        service = _make_service(tmp_dir)

        # 既存 Config を保存しておく
        service.save(initial)
        before = service.load()

        # 不正な dict をインポート → ValueError が送出されるはず
        with pytest.raises(ValueError):
            service.import_from_dict(invalid_data)

        # インポート後も Config は変更されていない
        after = service.load()
        assert asdict(after) == asdict(before)


# ---------------------------------------------------------------------------
# ユニットテスト（具体例・エッジケース）
# ---------------------------------------------------------------------------


class TestImportDataPreservation:
    """import_from_dict の具体的なデータ保全ケース"""

    def test_invalid_type_raises_and_preserves(self, tmp_path: Path) -> None:
        """型不正の dict は ValueError を送出し、既存 Config を変更しない"""
        service = ConfigService()
        service._config_path = tmp_path / "config.json"

        original = Config(
            ai_engine="stable_diffusion",
            output_directory="/tmp/out",
            openai_model="gpt-image-2.5-flare",
            openai_quality="medium",
            sd_endpoint="http://localhost:7860",
        )
        service.save(original)

        with pytest.raises(ValueError):
            service.import_from_dict({"ai_engine": 12345})

        loaded = service.load()
        assert asdict(loaded) == asdict(original)

    def test_valid_import_overwrites(self, tmp_path: Path) -> None:
        """検証を通過した dict は既存 Config を上書きする（保全されるのは不正時のみ）"""
        service = ConfigService()
        service._config_path = tmp_path / "config.json"

        service.save(Config(ai_engine="openai"))
        service.import_from_dict({"ai_engine": "midjourney", "sd_endpoint": "http://x"})

        loaded = service.load()
        assert loaded.ai_engine == "midjourney"
        assert loaded.sd_endpoint == "http://x"

    def test_invalid_import_before_any_save_keeps_default(
        self, tmp_path: Path
    ) -> None:
        """Config 未保存状態で不正インポートしてもデフォルト Config のまま"""
        service = ConfigService()
        service._config_path = tmp_path / "config.json"

        with pytest.raises(ValueError):
            service.import_from_dict({"output_directory": [1, 2, 3]})

        loaded = service.load()
        assert asdict(loaded) == asdict(Config())
