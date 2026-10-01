"""確定企画の検証と各画像へのプロンプト割当て。画像APIはモックする。"""

from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import GenerateRequest, app
from backend.models import GenerationProgress, GenerationRequest
from backend.services.image_generator_service import ImageGeneratorService
from backend.services.stamp_prompt import build_stamp_prompt


def plan():
    return [
        {"id": f"daily-{i+1}", "position": i, "meaning": word,
         "expression": "笑顔", "pose": "手を振る", "prop": ""}
        for i, word in enumerate(["おはよう", "こんにちは", "こんばんは", "おやすみ", "ありがとう", "またね", "了解", "おかえり"])
    ]


def payload(items=None, **overrides):
    data = {"prompt": "白いアザラシ", "count": 8, "startIndex": 0, "theme": "daily", "items": items if items is not None else plan()}
    data.update(overrides)
    return data


@pytest.mark.parametrize("mutation", [
    lambda items: items[:7],
    lambda items: [{**items[0], "meaning": " "}, *items[1:]],
    lambda items: [items[0], {**items[1], "meaning": " おはよう "}, *items[2:]],
    lambda items: [{**items[0], "position": 3}, *items[1:]],
])
def test_rejects_invalid_plan(mutation):
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(payload(mutation(plan())))


def test_rejects_out_of_range_slice():
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(payload(count=2, startIndex=7))


def test_invalid_plan_never_starts_image_service():
    bad_items = plan()
    bad_items[3]["meaning"] = " おはよう "
    with patch("backend.main._build_generator_service") as build:
        response = TestClient(app).post("/generate", json=payload(bad_items))
    assert response.status_code == 422
    build.assert_not_called()


def test_builds_only_target_item():
    text = build_stamp_prompt("白いアザラシ", plan()[3])
    assert "白いアザラシ" in text
    assert "おやすみ" in text
    assert "おはよう" not in text
    assert "文字を描かず" in text


async def test_partial_generation_uses_absolute_positions_and_separate_prompts():
    adapter = MagicMock()
    prompts = []

    async def generate(**kwargs):
        prompts.append(kwargs["prompt"])
        yield GenerationProgress(completed=1, total=1, latest_image_path="image.png", error=None, index=0)

    adapter.generate.side_effect = generate
    service = ImageGeneratorService(adapter)
    request = GenerationRequest(prompt="白いアザラシ", count=2, start_index=3, items=plan())
    results = [progress async for progress in service.generate_batch(request)]
    assert [result.index for result in results] == [3, 4]
    assert "おやすみ" in prompts[0]
    assert "ありがとう" in prompts[1]
    assert all("白いアザラシ" in prompt for prompt in prompts)
    assert all("おはよう" not in prompt for prompt in prompts)


async def test_eight_stamps_have_distinct_prompts_with_same_common_setting():
    adapter = MagicMock()
    prompts = []

    async def generate(**kwargs):
        prompts.append(kwargs["prompt"])
        yield GenerationProgress(completed=1, total=1, latest_image_path="image.png", error=None, index=0)

    adapter.generate.side_effect = generate
    request = GenerationRequest(prompt="白いアザラシ", count=8, items=plan())
    results = [progress async for progress in ImageGeneratorService(adapter).generate_batch(request)]
    assert [result.index for result in results] == list(range(8))
    assert len(set(prompts)) == 8
    assert all("白いアザラシ" in prompt for prompt in prompts)
    assert all(sum(word in prompt for word in [item["meaning"] for item in plan()]) == 1 for prompt in prompts)
