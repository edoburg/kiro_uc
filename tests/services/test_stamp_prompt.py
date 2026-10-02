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


def test_regeneration_uses_replaced_values_and_omits_blank_extra_instructions():
    changed = {**plan()[3], "pose": "仰向けで眠る", "prop": "", "additional_instructions": " 顔を隠さない "}
    text = build_stamp_prompt("白いアザラシ", changed)
    assert "ポーズ：仰向けで眠る" in text
    assert "小物：なし" in text
    assert "【今回のスタンプへの追加指示】\n顔を隠さない" in text
    assert "枕" not in text
    assert "丸くなって" not in text
    blank = build_stamp_prompt("白いアザラシ", {**changed, "additional_instructions": "  "})
    assert "【今回のスタンプへの追加指示】" not in blank
    assert "【今回のスタンプへの追加指示】" not in build_stamp_prompt("白いアザラシ", plan()[3])


def test_extra_instructions_camel_case_and_length_validation():
    changed = plan()
    changed[3]["additionalInstructions"] = "顔を隠さない"
    validated = GenerateRequest.model_validate(payload(changed))
    assert validated.items[3].additional_instructions == "顔を隠さない"
    assert validated.items[0].additional_instructions == ""
    changed[3]["additionalInstructions"] = "あ" * 501
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(payload(changed))


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


async def test_regeneration_sends_only_target_extra_instruction_to_adapter():
    adapter = MagicMock()
    prompts = []

    async def generate(**kwargs):
        prompts.append(kwargs["prompt"])
        yield GenerationProgress(completed=1, total=1, latest_image_path="image.png", error=None, index=0)

    adapter.generate.side_effect = generate
    items = plan()
    items[0]["additional_instructions"] = "朝日を右上に"
    items[3]["pose"] = "仰向けで眠る"
    items[3]["prop"] = "青い毛布"
    items[3]["additional_instructions"] = "顔を隠さない"
    service = ImageGeneratorService(adapter)
    request = GenerationRequest(prompt="白いアザラシ", count=1, start_index=3, items=items)
    result = [progress async for progress in service.generate_batch(request)]
    assert [progress.index for progress in result] == [3]
    assert len(prompts) == 1
    assert "仰向けで眠る" in prompts[0]
    assert "青い毛布" in prompts[0]
    assert "顔を隠さない" in prompts[0]
    assert "朝日を右上に" not in prompts[0]
