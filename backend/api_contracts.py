"""FastAPI の公開契約と内部 Python モデル間の変換。

レンダラーへ公開する JSON は TypeScript の命名規則に合わせて camelCase、
Python のサービス層・永続化層は snake_case を使用する。変換はこの API 境界へ
集約し、未知の入力フィールドは受け付けない。
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.models import RepresentativeSelection


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
    ai_engine: Literal["openai", "stable_diffusion", "midjourney"]
    output_directory: str
    openai_model: Literal["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]
    openai_quality: Literal["auto", "low", "medium", "high", "xhigh", "max"]
    sd_endpoint: str


class ProcessRequestPayload(ApiModel):
    source_path: str


class ExportImagePayload(ApiModel):
    # 選択IDの参照先。旧要求との互換のため省略可能（選択フィールドがある要求では必須）。
    id: str | None = Field(default=None, min_length=1, max_length=200)
    stamp_path: str
    main_image_path: str
    thumbnail_path: str


class RepresentativeSelectionFields(ApiModel):
    """メイン／タブ画像の選択ID。

    両フィールドとも省略した旧要求だけ images[0] を使う。どちらかを指定した要求は
    新しい契約として扱い、null・欠落・セット外のIDをエラーにする。
    """

    main_image_id: str | None = Field(default=None, max_length=200)
    tab_image_id: str | None = Field(default=None, max_length=200)

    def representative_selection(self) -> RepresentativeSelection | None:
        if not ({"main_image_id", "tab_image_id"} & self.model_fields_set):
            return None
        return RepresentativeSelection(
            main_image_id=self.main_image_id,
            tab_image_id=self.tab_image_id,
        )


class ExportStampSetPayload(RepresentativeSelectionFields):
    title: str
    description: str = ""
    images: list[ExportImagePayload]


class ExportRequestPayload(ApiModel):
    stamp_set: ExportStampSetPayload
    output_directory: str


class UploadImagePayload(ApiModel):
    id: str | None = Field(default=None, min_length=1, max_length=200)
    stamp_path: str
    main_image_path: str
    thumbnail_path: str


class UploadStampSetPayload(RepresentativeSelectionFields):
    # main_image_path / thumbnail_path は選択IDの解決結果の照合用（指定時に不一致なら400）。
    title: str
    description: str = ""
    creator_name: str
    copyright: str
    images: list[UploadImagePayload]
    main_image_path: str | None = None
    thumbnail_path: str | None = None


class UploadRequestPayload(ApiModel):
    stamp_set: UploadStampSetPayload
    email_credential_key: Literal["line_email"] = "line_email"
    password_credential_key: Literal["line_password"] = "line_password"
