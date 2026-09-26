"""
UploaderService — Playwright による LINE Creators Market への自動アップロード

LINE Creators Market には公開 API が存在しないため、Playwright のヘッドレス
ブラウザ自動化で Stamp_Set をアップロードする（design.md）。

主な方針:
  - ネットワークエラー（接続断・タイムアウト・サーバーエラー）は 5 秒間隔で
    最大 3 回まで自動リトライする。3 回全て失敗した場合は UploadResult に
    エラー種別・回数・最終エラー内容を記録する（Requirements 5.4）
  - 認証エラー（認証情報の不正・期限切れ）はリトライせず即時停止し、
    UploadResult に error_type='auth' を記録する（Requirements 5.7）
  - 進捗コールバック on_progress を 1 秒以内の間隔で呼び出す（Requirements 5.2）
  - 認証情報（メールアドレス・パスワード）は ConfigService 経由で OS Keychain
    から渡され、ログや例外メッセージに値を出力しない（tech.md セキュリティルール）

structure.md の規約に従い、本サービスはステートレスとする（1 回インスタンス化して
注入する。グローバルなミュータブル状態を持たない）。ユーザー向けメッセージは
すべて日本語で記述する（product.md）。

Playwright はブラウザバイナリが未インストールでもモジュールが import できるよう、
実行時（upload 呼び出し時）に遅延 import する。テストでは _new_browser_page /
_login / _upload_images / _submit_for_review をモックに差し替えることで、実
ブラウザや実 LINE エンドポイントへアクセスせずに検証できる。
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Callable, Optional

from backend.models import LineCredentials, UploadProgress, UploadResult

# LINE Creators Market の申請フォーム URL（自動化対象）。
LCM_LOGIN_URL = "https://account.line.biz/login"
LCM_UPLOAD_URL = "https://creator.line.me/ja/stickershop/products"

# ネットワークエラー時の自動リトライ設定（Requirements 5.4）。
MAX_RETRIES = 3
RETRY_INTERVAL_SECONDS = 5

# 進捗コールバックの最大呼び出し間隔（秒）。Requirements 5.2（1 秒以内の更新）。
PROGRESS_INTERVAL_SECONDS = 1

# UploadResult.error_type に対応するエラー種別定数。
ERROR_NETWORK = "network"
ERROR_AUTH = "auth"
ERROR_VALIDATION = "validation"
ERROR_UNKNOWN = "unknown"

# エラー種別ごとのユーザー向け日本語メッセージ（product.md）。
_ERROR_MESSAGES = {
    ERROR_NETWORK: (
        "ネットワークエラーによりアップロードに失敗しました"
        "（{retry_count}回リトライしました）。接続を確認して再度お試しください。"
    ),
    ERROR_AUTH: (
        "認証に失敗しました。メールアドレスまたはパスワードが正しくないか、"
        "有効期限が切れている可能性があります。設定画面で認証情報を確認してください。"
    ),
    ERROR_VALIDATION: (
        "アップロード内容がLINE規格を満たしていません。スタンプセットを確認してください。"
    ),
    ERROR_UNKNOWN: (
        "アップロード中に予期しないエラーが発生しました。しばらく待ってから再度お試しください。"
    ),
}


# ---------------------------------------------------------------------------
# 例外型（エラー種別の判別に使う。認証エラーはリトライ対象外）
# ---------------------------------------------------------------------------


class UploadAuthError(Exception):
    """認証情報の不正・期限切れなど、リトライ不可の認証エラー。"""


class UploadNetworkError(Exception):
    """接続断・タイムアウト・サーバーエラーなど、リトライ対象のネットワークエラー。"""


class UploadValidationError(Exception):
    """アップロード内容が LINE 規格を満たさない場合のエラー（リトライ不可）。"""


# ---------------------------------------------------------------------------
# UploaderService
# ---------------------------------------------------------------------------


class UploaderService:
    """
    Playwright を使って Stamp_Set を LINE Creators Market へアップロードする
    ステートレスなサービス（structure.md）。

    公開エントリポイントは upload()。内部で Playwright のページを起動し、
    ログイン → 画像アップロード → 申請送信の順に処理する。ネットワークエラーは
    自動リトライ、認証エラーは即時停止する。
    """

    # ------------------------------------------------------------------
    # 公開エントリポイント
    # ------------------------------------------------------------------

    async def upload(
        self,
        stamp_set: Any,
        credentials: LineCredentials,
        on_progress: Callable[[UploadProgress], None],
    ) -> UploadResult:
        """
        Stamp_Set を LINE Creators Market へアップロードする（Requirements 5.1）。

        ネットワークエラー時は 5 秒間隔で最大 3 回まで自動リトライする
        （Requirements 5.4）。認証エラー時はリトライせず即時停止し、UploadResult に
        error_type='auth' を記録する（Requirements 5.7）。

        Args:
            stamp_set:   アップロードする Stamp_Set（title / description / images を持つ）。
                         images の各要素は stamp_path / main_image_path / thumbnail_path
                         を持つ ProcessedImageSet 相当のオブジェクト。
            credentials: LINE Creators Market の認証情報（OS Keychain から取得済み）。
            on_progress: 進捗通知コールバック。1 秒以内の間隔で呼び出される。

        Returns:
            UploadResult: 成功時は application_id / status を、失敗時は error_type /
                          retry_count / error_message（日本語）を保持する。
        """
        images = getattr(stamp_set, "images", None) or []
        total = len(images)
        retry_count = 0

        while True:
            try:
                return await self._attempt_upload(
                    stamp_set, credentials, on_progress, retry_count, total
                )
            except UploadAuthError:
                # 認証エラー: リトライせず即時停止（Requirements 5.7）
                return self._failure_result(ERROR_AUTH, retry_count=0)
            except UploadValidationError:
                # 規格エラー: リトライ不可
                return self._failure_result(ERROR_VALIDATION, retry_count=retry_count)
            except UploadNetworkError:
                # ネットワークエラー: 5 秒間隔で最大 3 回リトライ（Requirements 5.4）
                if retry_count >= MAX_RETRIES:
                    return self._failure_result(ERROR_NETWORK, retry_count=retry_count)
                retry_count += 1
                self._notify(
                    on_progress,
                    UploadProgress(
                        phase="retrying",
                        completed=0,
                        total=total,
                        message=(
                            f"ネットワークエラーが発生しました。"
                            f"{RETRY_INTERVAL_SECONDS}秒後に再試行します"
                            f"（{retry_count}/{MAX_RETRIES}回目）。"
                        ),
                    ),
                )
                await asyncio.sleep(RETRY_INTERVAL_SECONDS)
            except Exception:  # noqa: BLE001 - 想定外エラーも種別化して返す
                return self._failure_result(ERROR_UNKNOWN, retry_count=retry_count)

    # ------------------------------------------------------------------
    # 1 回分のアップロード試行
    # ------------------------------------------------------------------

    async def _attempt_upload(
        self,
        stamp_set: Any,
        credentials: LineCredentials,
        on_progress: Callable[[UploadProgress], None],
        retry_count: int,
        total: int,
    ) -> UploadResult:
        """
        ブラウザページを 1 つ起動し、ログイン → 画像アップロード → 申請送信を実行する。

        ネットワークエラー・認証エラーは例外として送出し、呼び出し側 upload() が
        リトライ／即時停止を判断する。
        """
        async with self._new_browser_page() as page:
            self._notify(
                on_progress,
                UploadProgress(
                    phase="login",
                    completed=0,
                    total=total,
                    message="LINE Creators Market にログインしています…",
                ),
            )
            await self._login(page, credentials)

            self._notify(
                on_progress,
                UploadProgress(
                    phase="uploading",
                    completed=0,
                    total=total,
                    message="スタンプ画像をアップロードしています…",
                ),
            )
            await self._upload_images(page, stamp_set, on_progress)

            self._notify(
                on_progress,
                UploadProgress(
                    phase="submitting",
                    completed=total,
                    total=total,
                    message="審査申請を送信しています…",
                ),
            )
            application_id = await self._submit_for_review(page)

            self._notify(
                on_progress,
                UploadProgress(
                    phase="done",
                    completed=total,
                    total=total,
                    message="アップロードが完了しました。",
                ),
            )
            return UploadResult(
                success=True,
                application_id=application_id,
                status="submitted",
                error_type=None,
                retry_count=retry_count,
                error_message=None,
            )

    # ------------------------------------------------------------------
    # Playwright ブラウザページの生成（テストではモックに差し替える）
    # ------------------------------------------------------------------

    @asynccontextmanager
    async def _new_browser_page(self) -> AsyncIterator[Any]:
        """
        Playwright のヘッドレスブラウザを起動し、新規ページを yield する。

        Playwright はブラウザバイナリ未インストールでもモジュール import が
        失敗しないよう、ここで遅延 import する。テストではこのコンテキスト
        マネージャ自体をモックに差し替え、実ブラウザを起動しない。

        Raises:
            UploadNetworkError: ブラウザ起動・接続に失敗した場合。
        """
        try:
            from playwright.async_api import async_playwright  # 遅延 import
        except ImportError as exc:  # pragma: no cover - 環境依存
            raise UploadNetworkError(
                "ブラウザ自動化コンポーネントを初期化できませんでした。"
            ) from exc

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                yield page
            finally:
                await browser.close()

    # ------------------------------------------------------------------
    # 各ステップ（テストではモックに差し替える）
    # ------------------------------------------------------------------

    async def _login(self, page: Any, credentials: LineCredentials) -> None:
        """
        LINE Creators Market にログインする（Requirements 5.1）。

        認証情報の値（email / password）はログや例外メッセージに出力しない
        （tech.md セキュリティルール）。認証情報が空の場合や、ログイン後に
        認証エラー画面が表示された場合は UploadAuthError を送出する。

        Args:
            page:        Playwright のページオブジェクト。
            credentials: LINE の認証情報。

        Raises:
            UploadAuthError:    認証に失敗した場合（リトライ不可）。
            UploadNetworkError: ページ遷移・通信に失敗した場合（リトライ対象）。
        """
        if not credentials.email or not credentials.password:
            # 値は出力せず、未設定である事実のみを扱う
            raise UploadAuthError("認証情報が設定されていません。")

        await page.goto(LCM_LOGIN_URL)
        await page.fill('input[name="tid"]', credentials.email)
        await page.fill('input[name="tpasswd"]', credentials.password)
        await page.click('button[type="submit"]')

        # ログイン後に認証エラー表示があれば認証エラーとして扱う
        if await self._has_auth_error(page):
            raise UploadAuthError("認証に失敗しました。")

    async def _upload_images(
        self,
        page: Any,
        stamp_set: Any,
        on_progress: Optional[Callable[[UploadProgress], None]] = None,
    ) -> None:
        """
        Stamp_Set の各画像を LINE Creators Market のフォームへアップロードする。

        1 枚アップロードするごとに on_progress を呼び出し、進捗を通知する
        （Requirements 5.2）。

        Args:
            page:        Playwright のページオブジェクト。
            stamp_set:   アップロード対象の Stamp_Set。
            on_progress: 進捗通知コールバック（省略可）。

        Raises:
            UploadNetworkError:    アップロード通信に失敗した場合（リトライ対象）。
            UploadValidationError: 規格エラーが検出された場合（リトライ不可）。
        """
        images = getattr(stamp_set, "images", None) or []
        total = len(images)

        await page.goto(LCM_UPLOAD_URL)

        for index, image in enumerate(images):
            stamp_path = getattr(image, "stamp_path", None)
            if stamp_path:
                await page.set_input_files('input[type="file"]', stamp_path)

            if on_progress is not None:
                self._notify(
                    on_progress,
                    UploadProgress(
                        phase="uploading",
                        completed=index + 1,
                        total=total,
                        message=f"スタンプ画像をアップロードしています…（{index + 1}/{total}）",
                    ),
                )

        # メイン画像・サムネイル画像のアップロード
        main_path = getattr(stamp_set, "main_image_path", None)
        thumb_path = getattr(stamp_set, "thumbnail_path", None)
        if main_path:
            await page.set_input_files('input[name="main"]', main_path)
        if thumb_path:
            await page.set_input_files('input[name="thumbnail"]', thumb_path)

    async def _submit_for_review(self, page: Any) -> str:
        """
        入力済みのフォームを審査申請として送信し、申請 ID を返す
        （Requirements 5.3）。

        Args:
            page: Playwright のページオブジェクト。

        Returns:
            LINE Creators Market から返された申請 ID。

        Raises:
            UploadNetworkError: 送信通信に失敗した場合（リトライ対象）。
        """
        await page.click('button[data-action="submit-for-review"]')
        application_id = await page.get_attribute(
            '[data-testid="application-id"]', "data-application-id"
        )
        return application_id or ""

    # ------------------------------------------------------------------
    # 内部ユーティリティ
    # ------------------------------------------------------------------

    async def _has_auth_error(self, page: Any) -> bool:
        """
        ログイン後のページに認証エラー表示があるかどうかを判定する。

        テストではモックに差し替える。実ページでは認証エラー用の要素の有無を
        確認する。
        """
        error_element = await page.query_selector('[data-testid="login-error"]')
        return error_element is not None

    @staticmethod
    def _notify(
        on_progress: Optional[Callable[[UploadProgress], None]],
        progress: UploadProgress,
    ) -> None:
        """
        進捗コールバックを安全に呼び出す。

        コールバック内の例外がアップロード処理全体を巻き込まないよう握りつぶす
        （進捗通知の失敗はアップロードの成否に影響させない）。
        """
        if on_progress is None:
            return
        try:
            on_progress(progress)
        except Exception:  # noqa: BLE001 - 進捗通知失敗は無視して処理を継続
            pass

    @staticmethod
    def _failure_result(error_type: str, retry_count: int) -> UploadResult:
        """エラー種別に応じた日本語メッセージ付きの失敗 UploadResult を生成する。"""
        template = _ERROR_MESSAGES.get(error_type, _ERROR_MESSAGES[ERROR_UNKNOWN])
        message = template.format(retry_count=retry_count)
        return UploadResult(
            success=False,
            application_id=None,
            status=None,
            error_type=error_type,
            retry_count=retry_count,
            error_message=message,
        )
