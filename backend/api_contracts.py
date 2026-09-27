"""FastAPI の公開契約と内部 Python モデル間の変換。

レンダラーへ公開する JSON は TypeScript の命名規則に合わせて camelCase、
Python のサービス層・永続化層は snake_case を使用する。変換はこの API 境界へ
集約し、未知の入力フィールドは受け付けない。
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict


def to_camel(name: str) -> str:
    """snake_case のフィールド名を lowerCamelCase へ変換する。"""
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


def to_api_payload(value: Any) -> Any:
    """dataclass/dict/list を再帰的に camelCase の JSON 値へ変換する。"""
    if is_dataclass(value) and not isinstance(value, type):
        value = asdict(value)
    if isinstance(value, BaseModel):
        value = value.model_dump(by_alias=True)
    if isinstance(value, dict):
        return {to_camel(str(key)): to_api_payload(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_api_payload(item) for item in value]
    return value


class ApiModel(BaseModel):
    """camelCase JSONを受け取り、Pythonではsnake_caseで扱う基底モデル。"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=False,
        extra="forbid",
        strict=True,
    )


class ConfigPayload(ApiModel):
    ai_engine: str
    output_directory: str
    openai_model: str
    sd_endpoint: str


class ProcessRequestPayload(ApiModel):
    source_path: str


class ExportImagePayload(ApiModel):
    stamp_path: str
    main_image_path: str
    thumbnail_path: str


class ExportStampSetPayload(ApiModel):
    title: str
    description: str = ""
    images: list[ExportImagePayload]


class ExportRequestPayload(ApiModel):
    stamp_set: ExportStampSetPayload
    output_directory: str


class UploadImagePayload(ApiModel):
    stamp_path: str
    main_image_path: str = ""
    thumbnail_path: str = ""


class UploadStampSetPayload(ApiModel):
    title: str
    description: str = ""
    images: list[UploadImagePayload]
    main_image_path: str | None = None
    thumbnail_path: str | None = None


class UploadRequestPayload(ApiModel):
    stamp_set: UploadStampSetPayload
    email_credential_key: str = "line_email"
    password_credential_key: str = "line_password"
