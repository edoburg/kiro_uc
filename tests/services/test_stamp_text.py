"""文字設定の公開契約とプロンプトを画像APIのモックで検証する。"""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api_contracts import to_api_payload
from backend.main import GenerateRequest, app
from backend.models import GenerationProgress, GenerationRequest as ServiceRequest
from backend.services.image_generator_service import ImageGeneratorService
from backend.services.stamp_prompt import build_stamp_prompt


def items():
    return [{"id": f"item-{i}", "position": i, "meaning": f"意味{i}",
             "expression": "笑顔", "pose": "手を振る", "prop": ""} for i in range(8)]


def request(plan):
    return {"prompt": "白いアザラシ", "count": 8, "theme": "daily", "items": plan}


def test_legacy_defaults_and_camel_case_roundtrip():
    plan = items()
    for i, value in enumerate([None, "", "おはよう！★"]):
        plan[i].update(textEnabled=False, displayText=value)
    model = GenerateRequest.model_validate(request(plan))
    assert not model.items[7].text_enabled
    assert model.items[7].display_text is None
    assert [item.display_text for item in model.items[:3]] == [None, "", "おはよう！★"]
    assert to_api_payload(model)["items"][:3] == [
        {**plan[i], "additionalInstructions": ""} for i in range(3)]


@pytest.mark.parametrize("settings", [
    {"textEnabled": True, "displayText": ""},
    {"textEnabled": True, "displayText": " \t\n　"},
    {"textEnabled": True, "displayText": "あ" * 101},
    {"textEnabled": False, "displayText": "あ" * 101},
    {"textEnabled": "false"}, {"textEnabled": 1}, {"textEnabled": None},
    {"displayText": 12},
])
def test_invalid_text_never_starts_service(settings):
    plan = items()
    plan[3].update(settings)
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(request(plan))
    with patch("backend.main._build_generator_service") as build:
        assert TestClient(app).post("/generate", json=request(plan)).status_code == 422
        build.assert_not_called()


def test_blank_disabled_text_and_duplicate_display_text_are_allowed():
    plan = items()
    plan[0].update(textEnabled=False, displayText=" ")
    for item in plan[1:]:
        item.update(textEnabled=True, displayText="OK！")
    GenerateRequest.model_validate(request(plan))


def test_api_passes_text_settings_to_internal_service_without_loss():
    plan = items()
    plan[0].update(textEnabled=False, displayText="")
    plan[1].update(textEnabled=True, displayText=None)
    plan[3].update(textEnabled=True, displayText="おやすみ！★")
    captured = []

    async def generate_batch(req):
        captured.append(req)
        yield GenerationProgress(completed=1, total=1, latest_image_path=None, error=None, index=3)

    service = MagicMock()
    service.generate_batch.side_effect = generate_batch
    data = {**request(plan), "count": 1, "startIndex": 3}
    with patch("backend.main._build_generator_service", return_value=service), patch("backend.main.log_service.log"):
        response = TestClient(app).post("/generate", json=data)
    assert response.status_code == 200
    internal = captured[0]
    assert internal.start_index == 3
    assert internal.items[0]["text_enabled"] is False
    assert internal.items[0]["display_text"] == ""
    assert internal.items[1]["display_text"] is None
    assert internal.items[3]["display_text"] == "おやすみ！★"


def test_prompt_branches_and_meaning_fallback():
    item = {**items()[0], "text_enabled": True, "display_text": " おはよう！★ ",
            "additional_instructions": "文字なしで描いて"}
    prompt = build_stamp_prompt("白いアザラシ", item)
    assert "伝えたい意味：意味0" in prompt
    assert "画像に描く文字：「おはよう！★」" in prompt
    assert "手書き風" in prompt and "縁取り" in prompt
    assert "メッセージやロゴを描かない" not in prompt
    assert "文字なしで描いて" in prompt
    assert "共通設定・追加指示より優先" in prompt
    fallback = build_stamp_prompt("共通", {**item, "display_text": None})
    assert "画像に描く文字：「意味0」" in fallback
    off = build_stamp_prompt("共通", {**item, "text_enabled": False})
    assert "メッセージやロゴを描かない" in off
    assert "おはよう" not in off
    assert "画像に描く文字" not in off
    assert "手書き風" not in off and "縁取り" not in off


async def test_mixed_batch_preview_remaining_and_retry_use_absolute_settings():
    plan = items()
    plan[0].update(textEnabled=True, displayText=None)
    plan[3].update(textEnabled=True, displayText=" おやすみ！ ")
    plan[4].update(textEnabled=False, displayText="描かない保存文字")
    validated = GenerateRequest.model_validate(request(plan))
    internal = [item.model_dump() for item in validated.items]
    adapter = MagicMock()
    prompts = []

    async def generate(**kwargs):
        prompts.append(kwargs["prompt"])
        yield GenerationProgress(completed=1, total=1, latest_image_path="mock.png", error=None, index=0)

    adapter.generate.side_effect = generate
    service = ImageGeneratorService(adapter)
    for start, count in [(0, 1), (1, 7), (3, 1), (3, 1)]:
        result = [p async for p in service.generate_batch(
            ServiceRequest(prompt="共通", count=count, start_index=start, items=internal))]
        assert [p.index for p in result] == list(range(start, start + count))
    assert "画像に描く文字：「意味0」" in prompts[0]
    assert "画像に描く文字：「おやすみ！」" in prompts[3]
    assert "描かない保存文字" not in prompts[4]
    assert prompts[3] == prompts[8] == prompts[9]
