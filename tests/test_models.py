"""
バックエンドデータモデルのスモークテスト
タスク 1: テスト環境（pytest + Hypothesis）の動作確認用
"""

from __future__ import annotations

from dataclasses import asdict

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.models import (
    Config,
    GenerationError,
    GenerationProgress,
    LogEntry,
    ProcessedImageSet,
    UploadResult,
    ValidationResult,
)


# ---------------------------------------------------------------------------
# ValidationResult
# ---------------------------------------------------------------------------


class TestValidationResult:
    def test_passed_when_all_ok(self):
        result = ValidationResult(
            passed=True,
            size_ok=True,
            format_ok=True,
            file_size_ok=True,
            file_size_exceeded=False,
            details="OK",
        )
        assert result.passed is True
        assert result.file_size_exceeded is False

    def test_failed_when_size_not_ok(self):
        result = ValidationResult(
            passed=False,
            size_ok=False,
            format_ok=True,
            file_size_ok=True,
            file_size_exceeded=False,
            details="サイズ超過",
        )
        assert result.passed is False


# ---------------------------------------------------------------------------
# ProcessedImageSet
# ---------------------------------------------------------------------------


class TestProcessedImageSet:
    def test_creation(self):
        validation = ValidationResult(
            passed=True,
            size_ok=True,
            format_ok=True,
            file_size_ok=True,
            file_size_exceeded=False,
            details="OK",
        )
        image_set = ProcessedImageSet(
            stamp_path="/tmp/stamp.png",
            main_image_path="/tmp/main.png",
            thumbnail_path="/tmp/thumb.png",
            validation=validation,
        )
        assert image_set.stamp_path == "/tmp/stamp.png"
        assert image_set.validation.passed is True


# ---------------------------------------------------------------------------
# GenerationProgress
# ---------------------------------------------------------------------------


class TestGenerationProgress:
    def test_no_error(self):
        progress = GenerationProgress(
            completed=3,
            total=8,
            latest_image_path="/tmp/img3.png",
            error=None,
        )
        assert progress.completed == 3
        assert progress.error is None

    def test_with_error(self):
        error = GenerationError(
            index=2,
            error_type="timeout",
            message="タイムアウトエラー",
        )
        progress = GenerationProgress(
            completed=2,
            total=8,
            latest_image_path=None,
            error=error,
        )
        assert progress.error is not None
        assert progress.error.error_type == "timeout"


# ---------------------------------------------------------------------------
# UploadResult
# ---------------------------------------------------------------------------


class TestUploadResult:
    def test_success(self):
        result = UploadResult(
            success=True,
            application_id="APP-12345",
            status="submitted",
            error_type=None,
            retry_count=0,
            error_message=None,
        )
        assert result.success is True
        assert result.application_id == "APP-12345"

    def test_network_error(self):
        result = UploadResult(
            success=False,
            application_id=None,
            status=None,
            error_type="network",
            retry_count=3,
            error_message="ネットワークエラー",
        )
        assert result.success is False
        assert result.retry_count == 3
        assert result.error_type == "network"

    def test_auth_error_no_retry(self):
        result = UploadResult(
            success=False,
            application_id=None,
            status=None,
            error_type="auth",
            retry_count=0,
            error_message="認証エラー",
        )
        assert result.retry_count == 0


# ---------------------------------------------------------------------------
# LogEntry
# ---------------------------------------------------------------------------


class TestLogEntry:
    def test_creation(self):
        entry = LogEntry(
            timestamp="2024-01-01T00:00:00+00:00",
            level="INFO",
            module="test_module",
            message="テストメッセージ",
        )
        assert entry.level == "INFO"
        assert entry.timestamp == "2024-01-01T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


class TestConfig:
    def test_defaults(self):
        config = Config()
        assert config.ai_engine == "openai"
        assert config.openai_model == "gpt-image-2.5-flare"
        assert config.openai_quality == "auto"

    def test_custom_values(self):
        config = Config(
            ai_engine="stable_diffusion",
            output_directory="/tmp/stamps",
            openai_model="gpt-image-2.5-sunburst",
            openai_quality="max",
            sd_endpoint="http://localhost:7860",
        )
        assert config.ai_engine == "stable_diffusion"
        assert config.sd_endpoint == "http://localhost:7860"
        assert config.openai_quality == "max"

    def test_no_sensitive_fields_in_config(self):
        """Config には APIキー・パスワードフィールドが存在しないことを確認する（セキュリティ保証）"""
        config = Config()
        config_dict = asdict(config)
        assert "api_key" not in config_dict
        assert "password" not in config_dict
        assert "secret" not in config_dict


# ---------------------------------------------------------------------------
# Hypothesis スモークテスト（テスト環境の動作確認）
# ---------------------------------------------------------------------------

# Feature: line-stamp-generator, Property 0: モデルフィールドへの任意の文字列入力で例外が発生しない


@given(
    level=st.sampled_from(["INFO", "WARN", "ERROR"]),
    module=st.text(min_size=1, max_size=50),
    message=st.text(max_size=500),
    timestamp=st.text(min_size=1, max_size=30),
)
@settings(max_examples=100)
def test_log_entry_hypothesis_smoke(
    level: str, module: str, message: str, timestamp: str
) -> None:
    """任意の文字列入力で LogEntry の生成が例外をスローしない"""
    entry = LogEntry(
        timestamp=timestamp,
        level=level,
        module=module,
        message=message,
    )
    assert entry.level == level
    assert entry.module == module
    assert entry.message == message
