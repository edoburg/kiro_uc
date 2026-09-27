"""FastAPI公開契約（camelCase）と内部モデル（snake_case）の統合テスト。"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

import backend.main as main_module
from backend.api_contracts import to_api_payload
from backend.models import (
    GenerationProgress,
    ProcessedImageSet,
    UploadResult,
    ValidationResult,
)
from backend.services.config_service import ConfigService
from backend.services.log_service import LogService


CONFIG = {
    "aiEngine": "openai",
    "outputDirectory": "C:/line-stamps",
    "openaiModel": "gpt-image-2.5-flare",
    "sdEndpoint": "",
}


def _isolated_client(monkeypatch, tmp_path: Path) -> TestClient:
    config_service = ConfigService()
    config_service._config_path = tmp_path / "config.json"
    monkeypatch.setattr(main_module, "config_service", config_service)
    monkeypatch.setattr(main_module, "log_service", LogService(tmp_path / "logs"))
    return TestClient(main_module.app)


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
