"""
UploaderService リトライロジックのプロパティテスト（Property 11）

Feature: line-stamp-generator, Property 11: アップロードリトライロジック
Validates: Requirements 5.4, 5.7

design.md の UploaderService は以下の挙動を持つ:
  - ネットワークエラー（UploadNetworkError）は 5 秒間隔で最大 MAX_RETRIES(=3) 回まで
    自動リトライする。k 回目（k <= 3）の試行で成功すれば成功結果を返し、
    UploadResult.retry_count は実際に行ったリトライ回数と一致する。全試行が失敗した
    場合は error_type='network'、retry_count=3 となる（Requirements 5.4）。
  - 認証エラー（UploadAuthError）はリトライされず、error_type='auth'、retry_count=0
    となる（Requirements 5.7）。

本テストでは実ブラウザや実 LINE エンドポイントへアクセスしないよう、
_attempt_upload をモックに差し替え、asyncio.sleep をパッチして実待機を回避する。
認証情報はプレースホルダを使用し、値が例外・エラーメッセージに漏れないことも検証する。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.models import LineCredentials, UploadResult
from backend.services import uploader_service as us
from backend.services.uploader_service import (
    MAX_RETRIES,
    UploadAuthError,
    UploadNetworkError,
    UploaderService,
)

# 認証情報はプレースホルダ（実値ではない）。漏洩検査にも使用する。
_PLACEHOLDER_EMAIL = "placeholder-user@example.com"
_PLACEHOLDER_PASSWORD = "placeholder-secret-pw-0000"


def _make_credentials() -> LineCredentials:
    return LineCredentials(
        email=_PLACEHOLDER_EMAIL,
        password=_PLACEHOLDER_PASSWORD,
    )


def _success_result(retry_count: int) -> UploadResult:
    """_attempt_upload が最終的に成功したときに返す想定の結果。"""
    return UploadResult(
        success=True,
        application_id="app-123",
        status="submitted",
        error_type=None,
        retry_count=retry_count,
        error_message=None,
    )


class TestUploadRetryProperties:
    # ------------------------------------------------------------------
    # Feature: line-stamp-generator, Property 11: ネットワークエラーは k 回目で成功
    # Validates: Requirements 5.4
    # ------------------------------------------------------------------
    @settings(max_examples=100)
    @given(fail_before_success=st.integers(min_value=0, max_value=MAX_RETRIES))
    async def test_network_error_retried_until_success(self, fail_before_success):
        """
        最初の fail_before_success 回（0..MAX_RETRIES）が UploadNetworkError で失敗し、
        その後成功する場合、結果は成功で retry_count == fail_before_success となる。
        """
        service = UploaderService()
        credentials = _make_credentials()
        on_progress = MagicMock()

        call_state = {"attempt": 0}

        async def fake_attempt(stamp_set, creds, cb, retry_count, total):
            # upload() は失敗のたびに retry_count をインクリメントして再呼び出しする。
            # ここで受け取る retry_count は現在の試行が何回目のリトライかを表す。
            current = call_state["attempt"]
            call_state["attempt"] += 1
            if current < fail_before_success:
                raise UploadNetworkError("接続に失敗しました。")
            # 成功時、実装は現在の retry_count を UploadResult に載せる。
            return _success_result(retry_count)

        with patch.object(us.asyncio, "sleep", new=AsyncMock()) as sleep_mock, patch.object(
            service, "_attempt_upload", side_effect=fake_attempt
        ):
            result = await service.upload(_stamp_set(), credentials, on_progress)

        assert result.success is True
        assert result.error_type is None
        assert result.retry_count == fail_before_success
        # リトライした回数だけ sleep が呼ばれる。
        assert sleep_mock.await_count == fail_before_success

    # ------------------------------------------------------------------
    # Feature: line-stamp-generator, Property 11: 全試行失敗で network / retry_count=3
    # Validates: Requirements 5.4
    # ------------------------------------------------------------------
    @settings(max_examples=100)
    @given(extra=st.integers(min_value=0, max_value=5))
    async def test_network_error_exhausts_all_retries(self, extra):
        """
        すべての試行が UploadNetworkError で失敗する場合、error_type='network'、
        retry_count == MAX_RETRIES(=3) となる。extra は「常に失敗する」ことを表す
        任意のバリエーション（挙動は不変であることを確認するためのダミー入力）。
        """
        service = UploaderService()
        credentials = _make_credentials()
        on_progress = MagicMock()

        async def always_network_error(stamp_set, creds, cb, retry_count, total):
            raise UploadNetworkError("接続に失敗しました。")

        with patch.object(us.asyncio, "sleep", new=AsyncMock()) as sleep_mock, patch.object(
            service, "_attempt_upload", side_effect=always_network_error
        ):
            result = await service.upload(_stamp_set(), credentials, on_progress)

        assert result.success is False
        assert result.error_type == "network"
        assert result.retry_count == MAX_RETRIES
        # 初回 + MAX_RETRIES 回リトライの間に MAX_RETRIES 回 sleep する。
        assert sleep_mock.await_count == MAX_RETRIES
        # 認証情報の値がエラーメッセージに漏れていないこと。
        assert _PLACEHOLDER_EMAIL not in (result.error_message or "")
        assert _PLACEHOLDER_PASSWORD not in (result.error_message or "")

    # ------------------------------------------------------------------
    # Feature: line-stamp-generator, Property 11: 認証エラーはリトライしない
    # Validates: Requirements 5.7
    # ------------------------------------------------------------------
    @settings(max_examples=100)
    @given(
        email=st.text(min_size=0, max_size=30),
        password=st.text(min_size=0, max_size=30),
    )
    async def test_auth_error_never_retried(self, email, password):
        """
        UploadAuthError が発生した場合、MAX_RETRIES に関わらずリトライされず、
        error_type='auth'、retry_count=0 となる。認証情報の値はエラーメッセージに
        漏れない。
        """
        service = UploaderService()
        credentials = LineCredentials(email=email, password=password)
        on_progress = MagicMock()

        call_count = {"n": 0}

        async def always_auth_error(stamp_set, creds, cb, retry_count, total):
            call_count["n"] += 1
            raise UploadAuthError("認証に失敗しました。")

        with patch.object(us.asyncio, "sleep", new=AsyncMock()) as sleep_mock, patch.object(
            service, "_attempt_upload", side_effect=always_auth_error
        ):
            result = await service.upload(_stamp_set(), credentials, on_progress)

        assert result.success is False
        assert result.error_type == "auth"
        assert result.retry_count == 0
        # リトライされていない: _attempt_upload は 1 回、sleep は 0 回。
        assert call_count["n"] == 1
        assert sleep_mock.await_count == 0
        # 認証情報の値がエラーメッセージに漏れていないこと。
        message = result.error_message or ""
        if email:
            assert email not in message
        if password:
            assert password not in message


def _stamp_set():
    """images 属性のみ参照される軽量なスタンプセットスタブ。"""
    stamp_set = MagicMock()
    stamp_set.images = []
    return stamp_set
