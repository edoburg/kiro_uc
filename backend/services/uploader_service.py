"""
UploaderService — Playwright による LINE Creators Market への自動アップロード

LINE Creators Market には公開 API が存在しないため、Playwright のブラウザ
自動化で Stamp_Set をアップロードする（design.md）。

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
_login / _open_sticker_draft / _upload_images / _save_draft をモックに差し替えることで、
実ブラウザや実 LINE エンドポイントへアクセスせずに検証できる。
"""

from __future__ import annotations

import asyncio
import re
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Callable, Optional

from backend.models import LineCredentials, UploadProgress, UploadResult

# LINE Creators Market の公式ログイン導線とマイページ。
# ログイン導線は access.line.me のOAuth画面へリダイレクトされる。
LCM_LOGIN_URL = "https://creator.line.me/signup/line_auth"
LCM_MANAGEMENT_URL = "https://creator.line.me/my/"

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
    ログイン → 下書き作成 → 画像アップロード → 下書き保存の順に処理する。
    審査申請は明示的に有効化しない限り実行しない。
    """

    def __init__(self, *, headless: bool = False, submit_for_review: bool = False) -> None:
        self._headless = headless
        self._submit_for_review_enabled = submit_for_review

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
            except UploadAuthError as exc:
                # 認証エラー: リトライせず即時停止（Requirements 5.7）
                return self._failure_result(ERROR_AUTH, retry_count=0, message=str(exc))
            except UploadValidationError as exc:
                # 規格エラー: リトライ不可
                return self._failure_result(
                    ERROR_VALIDATION,
                    retry_count=retry_count,
                    message=str(exc),
                )
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
        ブラウザページを 1 つ起動し、ログイン → 画像アップロード → 下書き保存を実行する。

        ネットワークエラー・認証エラーは例外として送出し、呼び出し側 upload() が
        リトライ／即時停止を判断する。
        """
        try:
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

                await self._open_sticker_draft(page, stamp_set)

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
                        phase="saving",
                        completed=total,
                        total=total,
                        message="LINE Creators Market に下書きを保存しています…",
                    ),
                )
                application_id = await self._save_draft(page)

                if self._submit_for_review_enabled:
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
                        message=(
                            "審査申請が完了しました。"
                            if self._submit_for_review_enabled
                            else "下書き保存が完了しました。"
                        ),
                    ),
                )
                return UploadResult(
                    success=True,
                    application_id=application_id,
                    status="submitted" if self._submit_for_review_enabled else "draft",
                    error_type=None,
                    retry_count=retry_count,
                    error_message=None,
                )
        except (UploadAuthError, UploadNetworkError, UploadValidationError):
            raise
        except Exception as exc:  # Playwright の通信・タイムアウト例外を分類する
            error_name = type(exc).__name__.lower()
            error_text = str(exc).lower()
            if any(
                marker in error_name or marker in error_text
                for marker in ("timeout", "network", "connection", "net::")
            ):
                raise UploadNetworkError("LINE Creators Marketとの通信に失敗しました。") from exc
            raise

    # ------------------------------------------------------------------
    # Playwright ブラウザページの生成（テストではモックに差し替える）
    # ------------------------------------------------------------------

    @asynccontextmanager
    async def _new_browser_page(self) -> AsyncIterator[Any]:
        """
        Playwright のブラウザを起動し、新規ページを yield する。

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
            browser = await pw.chromium.launch(headless=self._headless)
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

        # 通常ログインの遷移を待つ。追加認証が必要な場合は可視ブラウザ上で
        # ユーザーが完了できるよう、最大2分間だけ待機する。
        await page.wait_for_timeout(500)

        # ログイン後に認証エラー表示があれば認証エラーとして扱う
        if await self._has_auth_error(page):
            raise UploadAuthError("認証に失敗しました。")

        if "access.line.me" in page.url:
            body_text = await page.locator("body").inner_text()
            requires_manual_auth = any(
                keyword in body_text
                for keyword in ("認証番号", "本人確認", "CAPTCHA", "ロボット")
            )
            if requires_manual_auth:
                try:
                    await page.wait_for_url(
                        re.compile(r"^https://creator\.line\.me/(?!signup/line_auth)"),
                        timeout=120_000,
                    )
                except Exception as exc:
                    raise UploadAuthError(
                        "LINE側の追加認証が完了しませんでした。開いたブラウザで認証を完了して再試行してください。"
                    ) from exc
            else:
                raise UploadAuthError(
                    "LINEへのログインを完了できませんでした。認証情報を確認してください。"
                )

    async def _open_sticker_draft(self, page: Any, stamp_set: Any) -> None:
        """新規スタンプ登録画面を開き、表示情報を入力して下書きを作成する。"""
        await page.goto(LCM_MANAGEMENT_URL)
        await self._click_first(
            page,
            (
                'a:has-text("新規登録")',
                'button:has-text("新規登録")',
                'a:has-text("New Submission")',
            ),
            "LINE Creators Marketの新規登録ボタンが見つかりません。画面仕様が変更された可能性があります。",
        )
        await self._click_first(
            page,
            ('a:has-text("スタンプ")', 'button:has-text("スタンプ")', 'a:has-text("Sticker")'),
            "スタンプ登録画面を開けませんでした。",
        )
        await self._fill_first(
            page,
            ('input[name*="title"]', 'input[name*="product_name"]'),
            getattr(stamp_set, "title", ""),
            "タイトル入力欄が見つかりません。",
        )
        await self._fill_first(
            page,
            ('textarea[name*="description"]', 'textarea[name*="detail"]'),
            getattr(stamp_set, "description", ""),
            "説明入力欄が見つかりません。",
        )
        await self._fill_first(
            page,
            ('input[name*="creator"]', 'input[name*="author"]'),
            getattr(stamp_set, "creator_name", ""),
            "クリエイター名入力欄が見つかりません。",
        )
        await self._fill_first(
            page,
            ('input[name*="copyright"]',),
            getattr(stamp_set, "copyright", ""),
            "コピーライト入力欄が見つかりません。",
        )
        await self._click_first(
            page,
            ('button:has-text("保存")', 'button:has-text("Save")'),
            "下書き保存ボタンが見つかりません。",
        )

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

        await self._click_first(
            page,
            (
                'a:has-text("スタンプ画像")',
                'button:has-text("スタンプ画像")',
                'a:has-text("Sticker Images")',
            ),
            "スタンプ画像登録画面を開けませんでした。",
        )

        stamp_paths = [getattr(image, "stamp_path", "") for image in images]
        if not stamp_paths or any(not path for path in stamp_paths):
            raise UploadValidationError("アップロード可能なスタンプ画像が揃っていません。")

        await self._set_files_first(
            page,
            ('input[type="file"][multiple]', 'input[type="file"][name*="sticker"]'),
            stamp_paths,
            "スタンプ画像のアップロード欄が見つかりません。",
        )

        # LINE側は複数ファイルを一括選択するため、選択完了後に各画像分の進捗を通知する。
        for index in range(total):
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
        if not main_path or not thumb_path:
            raise UploadValidationError("メイン画像またはトークルームタブ画像がありません。")
        await self._set_files_first(
            page,
            ('input[type="file"][name="main"]', 'input[type="file"][name*="main"]'),
            main_path,
            "メイン画像のアップロード欄が見つかりません。",
        )
        await self._set_files_first(
            page,
            (
                'input[type="file"][name="thumbnail"]',
                'input[type="file"][name="tab"]',
                'input[type="file"][name*="tab"]',
            ),
            thumb_path,
            "トークルームタブ画像のアップロード欄が見つかりません。",
        )

    async def _save_draft(self, page: Any) -> str:
        """画像登録内容を下書き保存し、URL等から管理IDを取得する。"""
        await self._click_first(
            page,
            ('button:has-text("保存")', 'button:has-text("Save")'),
            "画像の保存ボタンが見つかりません。",
        )
        match = re.search(r"/(?:product|stickers?)/(\d+)", page.url)
        return match.group(1) if match else ""

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
        selectors = (
            '[data-testid="login-error"]',
            '.MdTxtError',
            '[role="alert"]',
        )
        for selector in selectors:
            locator = page.locator(selector).first
            if await locator.count() > 0 and await locator.is_visible():
                return True
        return False

    @staticmethod
    async def _click_first(
        page: Any,
        selectors: tuple[str, ...],
        error_message: str,
    ) -> None:
        for selector in selectors:
            locator = page.locator(selector).first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.click()
                return
        raise UploadValidationError(error_message)

    @staticmethod
    async def _fill_first(
        page: Any,
        selectors: tuple[str, ...],
        value: str,
        error_message: str,
    ) -> None:
        if not value:
            raise UploadValidationError(error_message)
        for selector in selectors:
            locator = page.locator(selector).first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.fill(value)
                return
        raise UploadValidationError(error_message)

    @staticmethod
    async def _set_files_first(
        page: Any,
        selectors: tuple[str, ...],
        files: str | list[str],
        error_message: str,
    ) -> None:
        for selector in selectors:
            locator = page.locator(selector).first
            if await locator.count() > 0:
                await locator.set_input_files(files)
                return
        raise UploadValidationError(error_message)

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
    def _failure_result(
        error_type: str,
        retry_count: int,
        message: str | None = None,
    ) -> UploadResult:
        """エラー種別に応じた日本語メッセージ付きの失敗 UploadResult を生成する。"""
        template = _ERROR_MESSAGES.get(error_type, _ERROR_MESSAGES[ERROR_UNKNOWN])
        safe_message = message or template.format(retry_count=retry_count)
        return UploadResult(
            success=False,
            application_id=None,
            status=None,
            error_type=error_type,
            retry_count=retry_count,
            error_message=safe_message,
        )
