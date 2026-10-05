"""FastAPI公開契約（camelCase）と内部モデル（snake_case）の統合テスト。"""

from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import backend.main as main_module
from backend.api_contracts import to_api_payload
from backend.models import (
    GenerationError,
    GenerationProgress,
    ProcessedImageSet,
    UploadProgress,
    UploadResult,
    ValidationResult,
)
from backend.services.config_service import ConfigService
from backend.services.log_service import LogService


CONFIG = {
    "aiEngine": "openai",
    "outputDirectory": "C:/line-stamps",
    "openaiModel": "gpt-image-2.5-flare",
    "openaiQuality": "high",
    "sdEndpoint": "",
}


def _isolated_client(monkeypatch, tmp_path: Path) -> TestClient:
    config_service = ConfigService()
    config_service._config_path = tmp_path / "config.json"
    monkeypatch.setattr(main_module, "config_service", config_service)
    monkeypatch.setattr(main_module, "log_service", LogService(tmp_path / "logs"))
    return TestClient(main_module.app)


def _write_derived_images(tmp_path: Path, count: int) -> list[dict[str, str]]:
    """画像ごとに内容の異なる変換済みPNG（スタンプ・メイン・タブ）を作り、API形式で返す。"""
    images: list[dict[str, str]] = []
    for index in range(count):
        paths = {}
        for kind, size in (("stamp", (370, 320)), ("main", (240, 240)), ("thumb", (96, 74))):
            path = tmp_path / f"{index}_{kind}.png"
            Image.new("RGBA", size, (index * 30 % 256, 80, 160, 255)).save(path, format="PNG")
            paths[kind] = str(path)
        images.append(
            {
                "id": f"item-{index}",
                "stampPath": paths["stamp"],
                "mainImagePath": paths["main"],
                "thumbnailPath": paths["thumb"],
            }
        )
    return images


def test_config_save_get_export_import_roundtrip_camel_case(
    monkeypatch, tmp_path: Path
) -> None:
    client = _isolated_client(monkeypatch, tmp_path)

    response = client.post("/config", json=CONFIG)
    assert response.status_code == 200

    # 永続化層は従来どおりsnake_caseを使う。
    stored = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert stored["output_directory"] == "C:/line-stamps"
    assert "outputDirectory" not in stored

    loaded = client.get("/config")
    assert loaded.status_code == 200
    assert loaded.json() == CONFIG

    exported = client.get("/config/export")
    assert exported.status_code == 200
    assert exported.json() == CONFIG

    imported = client.post("/config/import", json=exported.json())
    assert imported.status_code == 200
    assert client.get("/config").json() == CONFIG


def test_config_rejects_snake_case_missing_and_unknown_fields(
    monkeypatch, tmp_path: Path
) -> None:
    client = _isolated_client(monkeypatch, tmp_path)

    snake_case = {
        "ai_engine": "openai",
        "output_directory": "C:/out",
        "openai_model": "gpt-image-2.5-flare",
        "openai_quality": "high",
        "sd_endpoint": "",
    }
    assert client.post("/config", json=snake_case).status_code == 422
    assert client.post("/config", json={**CONFIG, "unexpected": True}).status_code == 422
    assert client.post("/config", json={"aiEngine": "openai"}).status_code == 422


def test_process_response_is_camel_case(monkeypatch, tmp_path: Path) -> None:
    client = _isolated_client(monkeypatch, tmp_path)

    class FakeProcessor:
        async def process_image(self, source_path: str) -> ProcessedImageSet:
            assert source_path == "C:/tmp/source.png"
            return ProcessedImageSet(
                stamp_path="C:/tmp/source_stamp.png",
                main_image_path="C:/tmp/source_main.png",
                thumbnail_path="C:/tmp/source_thumb.png",
                validation=ValidationResult(
                    passed=True,
                    size_ok=True,
                    format_ok=True,
                    file_size_ok=True,
                    file_size_exceeded=False,
                    details="適合",
                ),
            )

    monkeypatch.setattr(main_module, "image_processor_service", FakeProcessor())
    response = client.post("/process", json={"sourcePath": "C:/tmp/source.png"})

    assert response.status_code == 200
    assert response.json() == {
        "stampPath": "C:/tmp/source_stamp.png",
        "mainImagePath": "C:/tmp/source_main.png",
        "thumbnailPath": "C:/tmp/source_thumb.png",
        "stampDataUrl": "",
        "mainImageDataUrl": "",
        "thumbnailDataUrl": "",
        "validation": {
            "passed": True,
            "sizeOk": True,
            "formatOk": True,
            "fileSizeOk": True,
            "fileSizeExceeded": False,
            "details": "適合",
        },
    }


def test_export_request_and_response_are_camel_case(monkeypatch, tmp_path: Path) -> None:
    client = _isolated_client(monkeypatch, tmp_path)
    # 旧要求（画像IDと選択フィールドなし）は先頭画像を使う互換経路
    legacy_image = {
        key: value for key, value in _write_derived_images(tmp_path, 1)[0].items() if key != "id"
    }

    response = client.post(
        "/export",
        json={
            "stampSet": {
                "title": "APIテスト",
                "description": "説明",
                "images": [legacy_image],
            },
            "outputDirectory": str(tmp_path / "exports"),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["fileName"] == "APIテスト.zip"
    assert payload["imageCount"] == 1
    assert "zip_path" not in payload
    with ZipFile(payload["zipPath"]) as archive:
        assert set(archive.namelist()) == {
            "01.png",
            "main.png",
            "tab.png",
            "metadata.json",
        }
        assert archive.read("main.png") == Path(legacy_image["mainImagePath"]).read_bytes()


def test_export_endpoint_uses_selected_main_and_tab_ids(monkeypatch, tmp_path: Path) -> None:
    client = _isolated_client(monkeypatch, tmp_path)
    images = _write_derived_images(tmp_path, 8)

    response = client.post(
        "/export",
        json={
            "stampSet": {
                "title": "選択テスト",
                "description": "",
                "images": images,
                "mainImageId": "item-2",
                "tabImageId": "item-4",
            },
            "outputDirectory": str(tmp_path / "exports"),
        },
    )

    assert response.status_code == 200
    with ZipFile(response.json()["zipPath"]) as archive:
        assert archive.read("main.png") == Path(images[2]["mainImagePath"]).read_bytes()
        assert archive.read("tab.png") == Path(images[4]["thumbnailPath"]).read_bytes()
        assert archive.read("01.png") == Path(images[0]["stampPath"]).read_bytes()
        assert archive.read("08.png") == Path(images[7]["stampPath"]).read_bytes()


@pytest.mark.parametrize(
    ("selection", "message"),
    [
        ({"mainImageId": "item-2"}, "トークルームタブ画像が選択されていません"),
        ({"mainImageId": None, "tabImageId": "item-1"}, "メイン画像が選択されていません"),
        ({"mainImageId": "missing", "tabImageId": "item-1"}, "見つかりません"),
    ],
)
def test_export_endpoint_rejects_explicit_missing_or_unknown_selection(
    monkeypatch, tmp_path: Path, selection: dict, message: str
) -> None:
    client = _isolated_client(monkeypatch, tmp_path)
    output = tmp_path / "exports"

    response = client.post(
        "/export",
        json={
            "stampSet": {
                "title": "不正",
                "description": "",
                "images": _write_derived_images(tmp_path, 3),
                **selection,
            },
            "outputDirectory": str(output),
        },
    )

    assert response.status_code == 400
    assert message in response.json()["detail"]
    assert not output.exists()


def test_stream_and_upload_contracts_are_camel_case() -> None:
    event = main_module._sse_event(
        GenerationProgress(
            completed=1,
            total=1,
            latest_image_path="C:/tmp/image.png",
            error=None,
            index=0,
            data_url="data:image/png;base64,AA==",
        ),
        event="progress",
    )
    payload = json.loads(next(line[6:] for line in event.splitlines() if line.startswith("data: ")))
    assert payload["latestImagePath"] == "C:/tmp/image.png"
    assert payload["dataUrl"].startswith("data:image/png")
    assert "latest_image_path" not in payload

    request = main_module.UploadRequest.model_validate(
        {
            "stampSet": {
                "title": "test",
                "description": "",
                "creatorName": "Test Creator",
                "copyright": "© Test Creator",
                "images": [
                    {
                        "stampPath": "C:/tmp/stamp.png",
                        "mainImagePath": "C:/tmp/main.png",
                        "thumbnailPath": "C:/tmp/thumb.png",
                    }
                ],
                "mainImagePath": "C:/tmp/main.png",
                "thumbnailPath": "C:/tmp/thumb.png",
            },
            "emailCredentialKey": "line_email",
            "passwordCredentialKey": "line_password",
        }
    )
    assert request.stamp_set.images[0].stamp_path == "C:/tmp/stamp.png"
    assert request.stamp_set.creator_name == "Test Creator"
    assert request.email_credential_key == "line_email"
    assert request.password_credential_key == "line_password"

    result = to_api_payload(
        UploadResult(
            success=False,
            application_id=None,
            status=None,
            error_type="auth",
            retry_count=0,
            error_message="認証に失敗しました。",
        )
    )
    assert result == {
        "success": False,
        "applicationId": None,
        "status": None,
        "errorType": "auth",
        "retryCount": 0,
        "errorMessage": "認証に失敗しました。",
    }


@pytest.mark.parametrize(
    "override",
    [
        {"prompt": " "},
        {"prompt": "x" * 1001},
        {"count": 0},
        {"count": 41},
        {"style": "unknown"},
        {"mode": "unknown"},
        {"model": "unknown"},
        {"quality": "ultra"},
        {"startIndex": -1},
        {"startIndex": 39, "count": 2},
        {"generationId": "invalid id with spaces"},
    ],
)
def test_generate_rejects_invalid_requests(
    monkeypatch, tmp_path: Path, override: dict
) -> None:
    client = _isolated_client(monkeypatch, tmp_path)
    request = {
        "prompt": "ねこ",
        "count": 1,
        "mode": "batch",
        "startIndex": 0,
        "model": "gpt-image-2.5-flare",
        "quality": "auto",
        **override,
    }

    assert client.post("/generate", json=request).status_code == 422


@pytest.mark.parametrize(
    ("fail_indexes", "expected_status"),
    [([], "done"), ([1], "partial"), ([0, 1], "failed")],
)
def test_generate_preserves_index_and_reports_outcome(
    monkeypatch,
    tmp_path: Path,
    fail_indexes: list[int],
    expected_status: str,
) -> None:
    client = _isolated_client(monkeypatch, tmp_path)
    captured = {}

    class FakeGenerator:
        async def generate_batch(self, request):
            captured["request"] = request
            completed = 0
            for local_index in range(request.count):
                index = request.start_index + local_index
                error = None
                if local_index in fail_indexes:
                    error = GenerationError(
                        index=index,
                        error_type="api_error",
                        message="生成に失敗しました。",
                    )
                else:
                    completed += 1
                yield GenerationProgress(
                    completed=completed,
                    total=request.count,
                    latest_image_path=None if error else f"C:/tmp/{index}.png",
                    error=error,
                    index=index,
                    data_url=None if error else "data:image/png;base64,AA==",
                )

    monkeypatch.setattr(main_module, "_build_generator_service", lambda _engine: FakeGenerator())
    response = client.post(
        "/generate",
        json={
            "prompt": "ねこ",
            "count": 2,
            "style": "かわいい",
            "mode": "batch",
            "startIndex": 5,
            "model": "gpt-image-2.5-sunburst",
            "quality": "xhigh",
        },
    )

    assert response.status_code == 200
    assert captured["request"].start_index == 5
    assert captured["request"].model == "gpt-image-2.5-sunburst"
    assert captured["request"].quality == "xhigh"
    assert '"index": 5' in response.text
    assert f'"status": "{expected_status}"' in response.text


def test_generate_logs_summary_and_failures_with_generation_id(
    monkeypatch, tmp_path: Path
) -> None:
    client = _isolated_client(monkeypatch, tmp_path)
    records: list[tuple[object, str, str]] = []

    class CapturingLogService:
        def log(self, level, module, message):
            records.append((level, module, message))

    class FakeGenerator:
        async def generate_batch(self, request):
            yield GenerationProgress(
                completed=1,
                total=2,
                latest_image_path="C:/tmp/0.png",
                error=None,
                index=0,
                data_url="data:image/png;base64,AA==",
            )
            yield GenerationProgress(
                completed=1,
                total=2,
                latest_image_path=None,
                error=GenerationError(
                    index=1,
                    error_type="api_error",
                    message="生成に失敗しました。",
                ),
                index=1,
                data_url=None,
            )

    monkeypatch.setattr(main_module, "log_service", CapturingLogService())
    monkeypatch.setattr(
        main_module, "_build_generator_service", lambda _engine: FakeGenerator()
    )
    response = client.post(
        "/generate",
        json={
            "prompt": "ねこ",
            "count": 2,
            "mode": "batch",
            "startIndex": 0,
            "model": "gpt-image-2.5-flare",
            "quality": "high",
            "generationId": "generate-test-42",
        },
    )

    assert response.status_code == 200
    generation_records = [record for record in records if record[1] == "main.generate"]
    assert len(generation_records) == 3
    assert all("generation_id=generate-test-42" in record[2] for record in generation_records)
    assert sum(record[0] == main_module.LogLevel.INFO for record in generation_records) == 2
    assert sum(record[0] == main_module.LogLevel.WARN for record in generation_records) == 1
    assert not any("画像を生成しました" in record[2] for record in generation_records)
    summary = generation_records[-1][2]
    assert "total=2" in summary
    assert "succeeded=1" in summary
    assert "failed=1" in summary
    assert "elapsed_ms=" in summary


def test_generate_fatal_error_log_uses_same_generation_id(
    monkeypatch, tmp_path: Path
) -> None:
    client = _isolated_client(monkeypatch, tmp_path)
    records: list[tuple[object, str, str]] = []

    class CapturingLogService:
        def log(self, level, module, message):
            records.append((level, module, message))

    class FailingGenerator:
        async def generate_batch(self, request):
            if False:
                yield None
            raise RuntimeError("unexpected failure")

    monkeypatch.setattr(main_module, "log_service", CapturingLogService())
    monkeypatch.setattr(
        main_module, "_build_generator_service", lambda _engine: FailingGenerator()
    )
    response = client.post(
        "/generate",
        json={
            "prompt": "ねこ",
            "count": 1,
            "mode": "batch",
            "startIndex": 0,
            "model": "gpt-image-2.5-flare",
            "quality": "auto",
            "generationId": "generate-failure-7",
        },
    )

    assert response.status_code == 200
    assert "event: error" in response.text
    error_records = [record for record in records if record[0] == main_module.LogLevel.ERROR]
    assert len(error_records) == 1
    assert "generation_id=generate-failure-7" in error_records[0][2]
    assert "elapsed_ms=" in error_records[0][2]


def test_upload_endpoint_reaches_service_and_streams_camel_case(
    monkeypatch, tmp_path: Path
) -> None:
    """camelCase要求をサービスへ渡し、進捗と結果もcamelCaseで配信する。"""
    client = _isolated_client(monkeypatch, tmp_path)
    credentials = {
        "line_email": "placeholder@example.com",
        "line_password": "placeholder-password",
    }
    monkeypatch.setattr(
        main_module.config_service,
        "get_credential",
        lambda key: credentials.get(key),
    )
    captured: dict[str, object] = {}

    class FakeUploader:
        async def upload(self, stamp_set, line_credentials, on_progress):
            captured["stamp_set"] = stamp_set
            captured["email"] = line_credentials.email
            on_progress(
                UploadProgress(
                    phase="saving",
                    completed=8,
                    total=8,
                    message="下書きを保存しています。",
                )
            )
            return UploadResult(
                success=True,
                application_id="12345",
                status="draft",
                error_type=None,
                retry_count=0,
                error_message=None,
            )

    monkeypatch.setattr(main_module, "uploader_service", FakeUploader())
    images = _write_derived_images(tmp_path, 8)
    response = client.post(
        "/upload",
        json={
            "stampSet": {
                "title": "test",
                "description": "description",
                "creatorName": "Test Creator",
                "copyright": "© Test Creator",
                "images": images,
                "mainImageId": "item-2",
                "tabImageId": "item-4",
                "mainImagePath": images[2]["mainImagePath"],
                "thumbnailPath": images[4]["thumbnailPath"],
            },
            "emailCredentialKey": "line_email",
            "passwordCredentialKey": "line_password",
        },
    )

    assert response.status_code == 200
    assert captured["email"] == "placeholder@example.com"
    assert captured["stamp_set"].creator_name == "Test Creator"
    # ZIPと同じ解決処理の結果（3枚目のメイン用・5枚目のタブ用）をアップローダーへ渡す
    assert captured["stamp_set"].main_image_path == images[2]["mainImagePath"]
    assert captured["stamp_set"].thumbnail_path == images[4]["thumbnailPath"]
    assert [image.stamp_path for image in captured["stamp_set"].images] == [
        image["stampPath"] for image in images
    ]
    assert '"phase": "saving"' in response.text
    assert '"applicationId": "12345"' in response.text
    assert '"status": "draft"' in response.text
    assert "placeholder-password" not in response.text


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"mainImageId": "missing", "tabImageId": "item-4"}, "見つかりません"),
        ({"tabImageId": "item-4"}, "メイン画像が選択されていません"),
        (
            {"mainImageId": "item-2", "tabImageId": "item-4", "mainImagePath": "IMAGE0_MAIN"},
            "メイン画像のパスが選択された画像と一致しません",
        ),
    ],
)
def test_upload_endpoint_rejects_invalid_selection_before_starting(
    monkeypatch, tmp_path: Path, overrides: dict, message: str
) -> None:
    """不正な選択はSSE開始前に400で拒否し、アップローダー（LINE送信）を呼ばない。"""
    client = _isolated_client(monkeypatch, tmp_path)
    monkeypatch.setattr(
        main_module.config_service, "get_credential", lambda key: "placeholder"
    )
    calls: list[object] = []

    class FakeUploader:
        async def upload(self, stamp_set, line_credentials, on_progress):  # pragma: no cover
            calls.append(stamp_set)
            raise AssertionError("アップロードを開始してはいけない")

    monkeypatch.setattr(main_module, "uploader_service", FakeUploader())
    images = _write_derived_images(tmp_path, 8)
    if overrides.get("mainImagePath") == "IMAGE0_MAIN":
        overrides = {**overrides, "mainImagePath": images[0]["mainImagePath"]}

    response = client.post(
        "/upload",
        json={
            "stampSet": {
                "title": "test",
                "description": "",
                "creatorName": "Test Creator",
                "copyright": "© Test Creator",
                "images": images,
                **overrides,
            },
        },
    )

    assert response.status_code == 400
    assert message in response.json()["detail"]
    assert calls == []


def test_credential_status_never_returns_secret(monkeypatch, tmp_path: Path) -> None:
    """認証情報の確認APIは設定有無だけを返し、値を返さない。"""
    client = _isolated_client(monkeypatch, tmp_path)
    monkeypatch.setattr(
        main_module.config_service,
        "get_credential",
        lambda key: "placeholder-secret" if key == "line_password" else None,
    )

    response = client.get("/config/credential/line_password")

    assert response.status_code == 200
    assert response.json() == {"key": "line_password", "configured": True}
    assert "placeholder-secret" not in response.text
