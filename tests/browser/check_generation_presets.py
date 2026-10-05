"""Appの保存・読込を実ファイルとサーバー再起動で検証（画像APIはモック）。"""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
from uuid import uuid4

from playwright.sync_api import sync_playwright, expect


def main():
    root = Path(__file__).resolve().parents[2]
    output = root / ".pytest_cache" / "generation-presets" / str(uuid4())
    output.mkdir(parents=True)
    url = "http://127.0.0.1:5199/tests/browser/generation-presets.html"
    log = (output / "server.log").open("w", encoding="utf-8")

    def start():
        process = subprocess.Popen(["node", "tests/browser/preset-server.mjs", str(output)], cwd=root, stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for _ in range(100):
            try:
                urllib.request.urlopen(url, timeout=1).close()
                return process
            except OSError:
                time.sleep(0.1)
        process.terminate()
        raise RuntimeError("Preset test server failed to start")

    process = start()
    try:
        with sync_playwright() as playwright:
            options = {"headless": True}
            if not Path(playwright.chromium.executable_path).exists():
                options["executable_path"] = str(Path(os.environ["PROGRAMFILES(X86)"]) / "Microsoft/Edge/Application/msedge.exe")
            browser = playwright.chromium.launch(**options)
            page = browser.new_page(viewport={"width": 1100, "height": 850})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url)
            toggle = page.get_by_role("button", name="生成設定の保存と読み込み", exact=True)
            expect(toggle).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_label("生成設定の保存名", exact=True)).not_to_be_visible()
            toggle.click()
            page.get_by_label("共通設定（キャラクターの外見・画風）").fill("再利用する白いアザラシ")
            page.get_by_label("作業の生成モデル", exact=True).select_option("gpt-image-2.5-sunburst")
            page.get_by_label("作業の生成品質", exact=True).select_option("max")
            page.get_by_role("button", name="スタンプ内容を作成", exact=True).click()
            fourth = page.get_by_role("group", name="4枚目", exact=True)
            fourth.get_by_label("ポーズ", exact=True).fill("仰向けで眠る")
            fourth.get_by_label("追加の指示（任意・500文字以内）", exact=True).fill("青い毛布で顔を隠さない")
            fourth.get_by_label("画像に描く文字", exact=True).fill("次回用の文字")
            fourth.get_by_label("文字を入れる", exact=True).uncheck()
            page.get_by_label("生成設定の保存名", exact=True).fill("アザラシ・日本語保存名")
            toggle.click()
            expect(page.get_by_label("生成設定の保存名", exact=True)).not_to_be_visible()
            toggle.click()
            expect(page.get_by_label("生成設定の保存名", exact=True)).to_have_value("アザラシ・日本語保存名")
            page.get_by_role("button", name="名前を付けて保存", exact=True).click()
            expect(page.get_by_role("button", name="アザラシ・日本語保存名を読み込み", exact=True)).to_be_enabled()
            assert page.evaluate("window.generationCalls.length") == 0
            files = list((output / "library").glob("*.json"))
            assert len(files) == 1
            saved = json.loads(files[0].read_text(encoding="utf-8"))
            assert saved["request"]["items"][3]["textEnabled"] is False
            assert saved["request"]["items"][3]["displayText"] == "次回用の文字"
            assert saved["request"]["items"][0]["displayText"] is None
            # Native confirmation dialogs must not interrupt typing after overwrite.
            native_save_dialogs = []

            def reject_save_dialog(dialog):
                native_save_dialogs.append(dialog.message)
                dialog.dismiss()

            page.on("dialog", reject_save_dialog)
            page.get_by_role("button", name="上書き保存", exact=True).click()
            page.get_by_role("button", name="上書きをキャンセル", exact=True).click()
            page.get_by_role("button", name="上書き保存", exact=True).click()
            page.get_by_role("button", name="この設定を上書きする", exact=True).click()
            expect(page.get_by_label("生成設定の保存名", exact=True)).to_be_focused()
            assert not native_save_dialogs, native_save_dialogs
            instructions = page.locator(".stamp-plan-editor__instructions textarea").nth(3)
            instructions.click()
            instructions.press("End")
            page.keyboard.type(" keyboard test")
            expect(instructions).to_have_value("青い毛布で顔を隠さない keyboard test")
            instructions.fill("青い毛布で顔を隠さない")
            bounds = instructions.bounding_box()
            pose_bounds = fourth.get_by_label("ポーズ", exact=True).bounding_box()
            assert bounds["width"] > pose_bounds["width"] * 2
            assert instructions.evaluate("el => getComputedStyle(el.parentElement).gridColumn") == "1 / -1"
            page.screenshot(path=str(output / "plan-instructions-wide.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 700})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.screenshot(path=str(output / "plan-instructions-narrow.png"), full_page=True)
            page.set_viewport_size({"width": 1100, "height": 850})
            page.get_by_role("button", name="アザラシ・日本語保存名を別名保存", exact=True).click()
            page.get_by_label("別名の保存名", exact=True).fill("別名の入力をキャンセル")
            page.get_by_role("button", name="別名保存をキャンセル", exact=True).click()
            assert len(list((output / "library").glob("*.json"))) == 1
            page.get_by_role("button", name="アザラシ・日本語保存名を別名保存", exact=True).click()
            page.get_by_label("別名の保存名", exact=True).fill("日本語の別名コピー")
            page.get_by_role("button", name="この名前でコピーを保存", exact=True).click()
            expect(page.get_by_role("button", name="日本語の別名コピーを読み込み", exact=True)).to_be_enabled()
            copies = [json.loads(file.read_text(encoding="utf-8")) for file in (output / "library").glob("*.json")]
            assert len(copies) == 2
            copied = next(copy for copy in copies if copy["name"] == "日本語の別名コピー")
            assert copied["id"] != saved["id"]
            assert copied["request"] == saved["request"]
            assert copied["options"] == saved["options"]
            assert page.evaluate("window.generationCalls.length") == 0
            page.close()
            process.terminate()
            process.wait(timeout=10)
            process = start()
            page = browser.new_page(viewport={"width": 1100, "height": 850})
            page.goto(url)
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="生成設定の保存と読み込み", exact=True).click()
            page.get_by_role("button", name="アザラシ・日本語保存名を読み込み", exact=True).click()
            expect(page.get_by_label("共通設定（キャラクターの外見・画風）")).to_have_value(saved["request"]["prompt"])
            expect(page.get_by_label("作業の生成モデル", exact=True)).to_have_value(saved["options"]["model"])
            expect(page.get_by_label("作業の生成品質", exact=True)).to_have_value(saved["options"]["quality"])
            page.screenshot(path=str(output / "preset-wide.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 700})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.screenshot(path=str(output / "preset-narrow.png"), full_page=True)
            page.get_by_role("button", name="スタンプ内容を作成", exact=True).click()
            fourth = page.get_by_role("group", name="4枚目", exact=True)
            expect(fourth.get_by_label("ポーズ", exact=True)).to_have_value("仰向けで眠る")
            expect(fourth.get_by_label("文字を入れる", exact=True)).not_to_be_checked()
            expect(fourth.get_by_label("画像に描く文字", exact=True)).to_have_value("次回用の文字")
            assert page.evaluate("window.generationCalls.length") == 0
            page.get_by_role("button", name="画像を生成", exact=True).click()
            page.wait_for_function("window.generationCalls.length === 1")
            sent = page.evaluate("window.generationCalls[0]")
            assert sent["model"] == saved["options"]["model"]
            assert sent["quality"] == saved["options"]["quality"]
            assert not errors, errors
            browser.close()
            print(f"PASS: Japanese named save, in-app overwrite/cancel, keyboard input after overwrite, full-width instructions, in-app copy/cancel, real JSON, server restart, restored draft/text/model/quality, no automatic generation, mock generation request, narrow layout; artifacts: {output}")
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        log.close()


if __name__ == "__main__":
    main()
