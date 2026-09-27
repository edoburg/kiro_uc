"""
UploaderService のユニットテスト（pytest + unittest.mock）

対象: backend/services/uploader_service.py

検証内容（Requirements 5.4, 5.7）:
  - 認証エラー時: リトライせず即時停止する。UploadResult.success が False、
    error_type == 'auth'、retry_count == 0（Requirements 5.7）
  - ネットワークエラーで 3 回リトライ全滅時: success False、error_type == 'network'、
    retry_count == 3、日本語の error_message を持つ（Requirements 5.4）
  - ハッピーパス: ログイン → 下書き作成 → 画像アップロード → 下書き保存を
    すべてモックし、success True・application_id・status を返す
  - on_progress コールバックが各フェーズ（login / uploading / saving / done）で
    呼び出される

セキュリティ（tech.md セキュリティルール）:
  - 実ブラウザ・実 LINE エンドポイントには一切アクセスせず、すべてモックする
  - モック認証情報はプレースホルダ値を使用し、その値が error_message に
    漏洩しないことを確認する

注意:
  - asyncio_mode = auto（pyproject.toml）のため、テストは async def で記述する
  - ネットワークリトライテストでは backend.services.uploader_service.asyncio.sleep を
    AsyncMock でパッチし、実際の 5 秒待機を発生させない
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from backend.models import LineCredentials, UploadProgress, UploadResult
from backend.services.uploader_service import (
    ERROR_AUTH,
    ERROR_NETWORK,
    LCM_LOGIN_URL,
    MAX_RETRIES,
    UploadAuthError,
    UploaderService,
    UploadNetworkError,
)

# テスト用プレースホルダ認証情報（実値ではない。漏洩検知にも使う）
_PLACEHOLDER_EMAIL = "placeholder-user@example.com"
_PLACEHOLDER_PASSWORD = "PLACEHOLDER-secret-should-not-leak"


# ---------------------------------------------------------------------------
# ヘルパー
# ---------------------------------------------------------------------------


def _make_credentials() -> LineCredentials:
    """プレースホルダ値のみを持つ認証情報を生成する。"""
    return LineCredentials(email=_PLACEHOLDER_EMAIL, password=_PLACEHOLDER_PASSWORD)


def _make_stamp_set(image_count: int = 8) -> SimpleNamespace:
    """
    アップロード対象の Stamp_Set 相当のモックを生成する。

    images の各要素は stamp_path を持ち、Stamp_Set 自体は main_image_path /
    thumbnail_path を持つ（uploader_service が getattr で参照する属性）。
    """
    images = [
        SimpleNamespace(
            stamp_path=f"/tmp/stamp_{i}.png",
            main_image_path=f"/tmp/main_{i}.png",
            thumbnail_path=f"/tmp/thumb_{i}.png",
        )
        for i in range(image_count)
    ]
    return SimpleNamespace(
        title="テストスタンプ",
        description="テスト用スタンプセット",
        creator_name="テスト制作者",
        copyright="© Test Creator",
        images=images,
        main_image_path="/tmp/main.png",
        thumbnail_path="/tmp/thumb.png",
    )


def _patch_browser_page(service: UploaderService, page: MagicMock) -> None:
    """
    _new_browser_page を、渡した page を yield するモックに差し替える。

    実ブラウザを起動せずにアップロードフローを検証するために使う。
    """

    @asynccontextmanager
    async def _fake_page():
        yield page

    service._new_browser_page = _fake_page  # type: ignore[method-assign]


# ---------------------------------------------------------------------------
# 認証エラー: 即時停止（Requirements 5.7）
# ---------------------------------------------------------------------------


async def test_auth_error_stops_immediately_without_retry():
    """認証エラー時はリトライせず、retry_count == 0 で即時停止する。"""
    service = UploaderService()

    # _login が認証エラーを送出するようモック
    service._login = AsyncMock(side_effect=UploadAuthError("認証に失敗しました。"))  # type: ignore[method-assign]
    upload_images_mock = AsyncMock()
    service._upload_images = upload_images_mock  # type: ignore[method-assign]
    open_draft_mock = AsyncMock()
    service._open_sticker_draft = open_draft_mock  # type: ignore[method-assign]
    _patch_browser_page(service, MagicMock())

    with patch(
        "backend.services.uploader_service.asyncio.sleep", new=AsyncMock()
    ) as sleep_mock:
        result = await service.upload(
            _make_stamp_set(), _make_credentials(), on_progress=lambda p: None
        )

    assert isinstance(result, UploadResult)
    assert result.success is False
    assert result.error_type == ERROR_AUTH
    assert result.retry_count == 0
    # 即時停止のため、後続ステップ・リトライ待機は発生しない
    upload_images_mock.assert_not_awaited()
    open_draft_mock.assert_not_awaited()
    sleep_mock.assert_not_awaited()
    # 認証情報の値が漏洩していないこと
    assert result.error_message is not None
    assert _PLACEHOLDER_EMAIL not in result.error_message
    assert _PLACEHOLDER_PASSWORD not in result.error_message


# ---------------------------------------------------------------------------
# ネットワークエラー: 3 回リトライ全滅（Requirements 5.4）
# ---------------------------------------------------------------------------


async def test_network_error_retries_three_times_then_fails():
    """
    ネットワークエラーが継続する場合、最大 3 回リトライした後に失敗結果を返す。

    error_type == 'network'、retry_count == 3、日本語の error_message を持つ。
    実 5 秒待機を避けるため asyncio.sleep を AsyncMock でパッチする。
    """
    service = UploaderService()

    # _login が毎回ネットワークエラーを送出するようモック
    service._login = AsyncMock(side_effect=UploadNetworkError("接続に失敗しました。"))  # type: ignore[method-assign]
    service._open_sticker_draft = AsyncMock()  # type: ignore[method-assign]
    service._upload_images = AsyncMock()  # type: ignore[method-assign]
    _patch_browser_page(service, MagicMock())

    progress_events: list[UploadProgress] = []

    with patch(
        "backend.services.uploader_service.asyncio.sleep", new=AsyncMock()
    ) as sleep_mock:
        result = await service.upload(
            _make_stamp_set(),
            _make_credentials(),
            on_progress=progress_events.append,
        )

    assert result.success is False
    assert result.error_type == ERROR_NETWORK
    assert result.retry_count == MAX_RETRIES == 3
    # 日本語のエラーメッセージが設定されている
    assert result.error_message is not None
    assert "ネットワーク" in result.error_message
    # リトライ間隔の待機は 3 回発生する（各回 5 秒だが実待機はしない）
    assert sleep_mock.await_count == MAX_RETRIES
    # リトライ進捗が通知されている
    assert any(p.phase == "retrying" for p in progress_events)
    # 認証情報が漏洩していない
    assert _PLACEHOLDER_EMAIL not in result.error_message
    assert _PLACEHOLDER_PASSWORD not in result.error_message


# ---------------------------------------------------------------------------
# ハッピーパス: 完全モックのページフロー
# ---------------------------------------------------------------------------


async def test_happy_path_returns_success_with_application_id():
    """
    ログイン → 画像アップロード → 下書き保存がすべて成功すると、success True と
    管理ID / draft ステータスを持つ UploadResult を返す。
    """
    service = UploaderService()

    service._login = AsyncMock()  # type: ignore[method-assign]
    service._open_sticker_draft = AsyncMock()  # type: ignore[method-assign]
    service._upload_images = AsyncMock()  # type: ignore[method-assign]
    service._save_draft = AsyncMock(return_value="12345")  # type: ignore[method-assign]
    service._submit_for_review = AsyncMock()  # type: ignore[method-assign]
    _patch_browser_page(service, MagicMock())

    result = await service.upload(
        _make_stamp_set(), _make_credentials(), on_progress=lambda p: None
    )

    assert result.success is True
    assert result.application_id == "12345"
    assert result.status == "draft"
    assert result.error_type is None
    assert result.error_message is None
    service._login.assert_awaited_once()
    service._open_sticker_draft.assert_awaited_once()
    service._upload_images.assert_awaited_once()
    service._save_draft.assert_awaited_once()
    service._submit_for_review.assert_not_awaited()


async def test_review_submission_runs_only_when_explicitly_enabled():
    """明示的に有効化した場合だけ、下書き保存後に審査申請を送信する。"""
    service = UploaderService(submit_for_review=True)
    service._login = AsyncMock()  # type: ignore[method-assign]
    service._open_sticker_draft = AsyncMock()  # type: ignore[method-assign]
    service._upload_images = AsyncMock()  # type: ignore[method-assign]
    service._save_draft = AsyncMock(return_value="12345")  # type: ignore[method-assign]
    service._submit_for_review = AsyncMock(return_value="APP-12345")  # type: ignore[method-assign]
    _patch_browser_page(service, MagicMock())

    result = await service.upload(
        _make_stamp_set(), _make_credentials(), on_progress=lambda p: None
    )

    assert result.success is True
    assert result.application_id == "APP-12345"
    assert result.status == "submitted"
    service._submit_for_review.assert_awaited_once()


async def test_on_progress_invoked_for_each_phase():
    """on_progress が login / uploading / saving / done の各フェーズで呼ばれる。"""
    service = UploaderService()

    service._login = AsyncMock()  # type: ignore[method-assign]
    service._open_sticker_draft = AsyncMock()  # type: ignore[method-assign]
    service._upload_images = AsyncMock()  # type: ignore[method-assign]
    service._save_draft = AsyncMock(return_value="99999")  # type: ignore[method-assign]
    _patch_browser_page(service, MagicMock())

    progress_events: list[UploadProgress] = []

    result = await service.upload(
        _make_stamp_set(),
        _make_credentials(),
        on_progress=progress_events.append,
    )

    assert result.success is True
    phases = {p.phase for p in progress_events}
    for expected_phase in ("login", "uploading", "saving", "done"):
        assert expected_phase in phases, f"{expected_phase} フェーズが通知されていない"


async def test_login_uses_current_official_line_login_fields():
    """公式ログイン導線と確認済みの tid / tpasswd 入力欄を使う。"""
    service = UploaderService()
    page = MagicMock()
    page.goto = AsyncMock()
    page.fill = AsyncMock()
    page.click = AsyncMock()
    page.wait_for_timeout = AsyncMock()
    page.url = "https://creator.line.me/my/"
    service._has_auth_error = AsyncMock(return_value=False)  # type: ignore[method-assign]

    await service._login(page, _make_credentials())

    page.goto.assert_awaited_once_with(LCM_LOGIN_URL)
    page.fill.assert_any_await('input[name="tid"]', _PLACEHOLDER_EMAIL)
    page.fill.assert_any_await('input[name="tpasswd"]', _PLACEHOLDER_PASSWORD)
    page.click.assert_awaited_once_with('button[type="submit"]')


async def test_upload_images_selects_all_required_files_and_reports_progress():
    """スタンプ一式・メイン・タブ画像を選択し、全画像分の進捗を通知する。"""
    service = UploaderService()
    service._click_first = AsyncMock()  # type: ignore[method-assign]
    service._set_files_first = AsyncMock()  # type: ignore[method-assign]
    progress_events: list[UploadProgress] = []

    await service._upload_images(
        MagicMock(),
        _make_stamp_set(image_count=8),
        on_progress=progress_events.append,
    )

    assert service._set_files_first.await_count == 3
    assert [event.completed for event in progress_events] == list(range(1, 9))
    assert all(event.phase == "uploading" for event in progress_events)
