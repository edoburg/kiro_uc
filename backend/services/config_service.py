"""
ConfigService — アプリ設定の永続化と OS Keychain 認証情報管理

- Config は ~/.line-stamp-gen/config.json に保存する
- APIキー・認証情報は OS Keychain（python-keyring）に保存する
- export_sanitized() は api_key・password を含むフィールドを除外する
- import_from_dict() は Pydantic スキーマ検証後のみ既存 Config を上書きする
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import keyring
from pydantic import BaseModel, ValidationError

from backend.models import Config


# ---------------------------------------------------------------------------
# Pydantic スキーマ（インポート時のバリデーション用）
# ---------------------------------------------------------------------------


class ConfigSchema(BaseModel):
    """
    Config のインポート時に Pydantic でスキーマ検証するためのモデル。
    フィールドは backend.models.Config のデータクラスと対応させる。
    """

    ai_engine: str = "openai"
    output_directory: str = ""
    openai_model: str = "gpt-image-2.5-flare"
    sd_endpoint: str = ""


# ---------------------------------------------------------------------------
# ConfigService
# ---------------------------------------------------------------------------


class ConfigService:
    """
    アプリ設定の永続化と OS Keychain 認証情報管理サービス。

    Attributes:
        CONFIG_FILE: 設定ファイルの保存パス（~/.line-stamp-gen/config.json）
        KEYCHAIN_SERVICE: OS Keychain のサービス名
    """

    CONFIG_FILE = "~/.line-stamp-gen/config.json"
    KEYCHAIN_SERVICE = "line-stamp-generator"

    # センシティブフィールドの判定キーワード（小文字で比較）
    _SENSITIVE_KEYWORDS = ("api_key", "password")

    def __init__(self) -> None:
        self._config_path = Path(os.path.expanduser(self.CONFIG_FILE))

    # ------------------------------------------------------------------
    # 内部ユーティリティ
    # ------------------------------------------------------------------

    def _ensure_dir(self) -> None:
        """設定ファイルの親ディレクトリを作成する（存在する場合は何もしない）。"""
        self._config_path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _is_sensitive(key: str) -> bool:
        """キー名がセンシティブフィールドかどうかを判定する。"""
        lower = key.lower()
        return any(kw in lower for kw in ConfigService._SENSITIVE_KEYWORDS)

    # ------------------------------------------------------------------
    # 設定の読み書き
    # ------------------------------------------------------------------

    def load(self) -> Config:
        """
        設定ファイルから Config を読み込む。
        ファイルが存在しない場合はデフォルト値の Config を返す。

        Returns:
            読み込んだ Config オブジェクト
        """
        if not self._config_path.exists():
            return Config()

        try:
            raw = self._config_path.read_text(encoding="utf-8")
            data = json.loads(raw)
        except (OSError, json.JSONDecodeError):
            # 読み込みエラーはデフォルト Config にフォールバック
            return Config()

        # Pydantic でバリデーションしてから dataclass に変換
        try:
            schema = ConfigSchema(**data)
        except (ValidationError, TypeError):
            return Config()

        return Config(
            ai_engine=schema.ai_engine,
            output_directory=schema.output_directory,
            openai_model=schema.openai_model,
            sd_endpoint=schema.sd_endpoint,
        )

    def save(self, config: Config) -> None:
        """
        Config を設定ファイルに保存する（Requirements 6.4）。
        センシティブフィールドは保存しない。

        Args:
            config: 保存する Config オブジェクト

        Raises:
            OSError: ファイルへの書き込みに失敗した場合
        """
        self._ensure_dir()
        data = {k: v for k, v in asdict(config).items() if not self._is_sensitive(k)}
        self._config_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ------------------------------------------------------------------
    # エクスポート / インポート
    # ------------------------------------------------------------------

    def export_sanitized(self) -> dict:
        """
        センシティブフィールド（api_key・password を含むキー）を除いた設定を
        dict として返す（Requirements 6.5）。

        Returns:
            サニタイズ済みの設定 dict
        """
        config = self.load()
        raw = asdict(config)
        return {k: v for k, v in raw.items() if not self._is_sensitive(k)}

    def import_from_dict(self, data: dict) -> None:
        """
        dict から設定をインポートする。Pydantic スキーマ検証に通過した場合のみ
        既存 Config を上書きする（Requirements 6.6, 6.7）。

        Args:
            data: インポートする設定の dict

        Raises:
            ValueError: スキーマ検証に失敗した場合（既存 Config は変更されない）
        """
        try:
            schema = ConfigSchema(**data)
        except (ValidationError, TypeError) as exc:
            raise ValueError(
                f"設定のスキーマ検証に失敗しました: {exc}"
            ) from exc

        new_config = Config(
            ai_engine=schema.ai_engine,
            output_directory=schema.output_directory,
            openai_model=schema.openai_model,
            sd_endpoint=schema.sd_endpoint,
        )
        self.save(new_config)

    # ------------------------------------------------------------------
    # OS Keychain 認証情報管理
    # ------------------------------------------------------------------

    def save_credential(self, key: str, value: str) -> None:
        """
        認証情報を OS Keychain に保存する（Requirements 6.2）。

        Args:
            key:   Keychain のユーザー名（例: "openai_api_key"）
            value: 保存する値（APIキーやパスワード）
        """
        keyring.set_password(self.KEYCHAIN_SERVICE, key, value)

    def get_credential(self, key: str) -> Optional[str]:
        """
        OS Keychain から認証情報を取得する（Requirements 6.2）。

        Args:
            key: Keychain のユーザー名

        Returns:
            取得した値。存在しない場合は None
        """
        return keyring.get_password(self.KEYCHAIN_SERVICE, key)
