"""ローカル合成PNGだけでCSS透過表示・拡大・キーボード操作を検証する。

実行: .venv/Scripts/python.exe tests/browser/check_image_review.py
外部APIは呼ばない。結果PNGは .pytest_cache/image-review/ に保存する。
"""
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

from PIL import Image
from playwright.sync_api import sync_playwright


def main():
    root = Path(__file__).resolve().parents[2]
    output = root / ".pytest_cache" / "image-review"
    output.mkdir(parents=True, exist_ok=True)
    transparent = Image.new("RGBA", (2, 2), (255, 255, 255, 255))
    transparent.putpixel((0, 0), (0, 0, 0, 0))
    transparent.putpixel((0, 1), (190, 190, 190, 255))
    transparent.putpixel((1, 1), (70, 70, 70, 255))
    opaque = Image.new("RGBA", (2, 2), (255, 255, 255, 255))
    baked = Image.new("RGBA", (2, 2))
    baked.putdata([(190, 190, 190, 255), (70, 70, 70, 255), (70, 70, 70, 255), (190, 190, 190, 255)])
    fixtures = []
    for image in (transparent, opaque, baked):
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        fixtures.append("data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode())
    (output / "fixtures.json").write_text(json.dumps(fixtures), encoding="utf-8")
    with (output / "server.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(["node", "tests/browser/review-server.mjs"], cwd=root, stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            url = "http://127.0.0.1:5198/tests/browser/image-review.html"
            for _ in range(100):
                try:
                    urllib.request.urlopen(url, timeout=1).close()
                    break
                except OSError:
                    time.sleep(0.1)
            with sync_playwright() as playwright:
                options = {"headless": True}
                if not Path(playwright.chromium.executable_path).exists():
                    edge = Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Microsoft/Edge/Application/msedge.exe"
                    options["executable_path"] = str(edge)
                browser = playwright.chromium.launch(**options)
                page = browser.new_page(viewport={"width": 1100, "height": 850}, device_scale_factor=1)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(url)
                first = page.get_by_alt_text("生成されたスタンプ画像 1", exact=True)
                first.wait_for()
                for color, expected in (("black", (0, 0, 0)), ("white", (255, 255, 255))):
                    page.get_by_label("表示背景", exact=True).select_option(color)
                    for index in range(3):
                        locator = page.get_by_alt_text(f"生成されたスタンプ画像 {index + 1}", exact=True)
                        pixels = Image.open(io.BytesIO(locator.screenshot())).convert("RGB")
                        quarter = (pixels.width // 4, pixels.height // 4)
                        if index == 0:
                            assert pixels.getpixel(quarter) == expected
                            assert pixels.getpixel((pixels.width * 3 // 4, pixels.height // 4)) == (255, 255, 255)
                        elif index == 1:
                            assert pixels.getpixel(quarter) == (255, 255, 255)
                        else:
                            assert pixels.getpixel(quarter) == (190, 190, 190)
                        assert locator.get_attribute("src") == fixtures[index]
                    page.screenshot(path=str(output / f"background-{color}.png"))
                opener = page.get_by_role("button", name="画像 1 を大きく表示", exact=True)
                opener.focus()
                page.keyboard.press("Enter")
                dialog = page.get_by_role("dialog")
                dialog.wait_for()
                assert dialog.locator("img").evaluate("node => getComputedStyle(node).objectFit") == "contain"
                page.screenshot(path=str(output / "review-wide.png"))
                dialog.get_by_role("button", name="拡大", exact=True).click()
                viewport = dialog.locator(".image-review-viewport")
                assert viewport.evaluate("node => node.scrollWidth > node.clientWidth && node.scrollHeight > node.clientHeight")
                dialog.get_by_role("button", name="表示領域に収める", exact=True).click()
                dialog.get_by_role("button", name="次の画像", exact=True).click()
                assert page.get_by_role("dialog").get_attribute("aria-label") == "画像 2 の詳細レビュー"
                page.keyboard.press("Escape")
                assert opener.evaluate("node => document.activeElement === node")
                page.set_viewport_size({"width": 390, "height": 640})
                opener.click()
                dialog = page.get_by_role("dialog")
                assert dialog.evaluate("node => node.scrollHeight > node.clientHeight")
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                page.screenshot(path=str(output / "review-narrow.png"))
                assert not errors, errors
                browser.close()
                print("PASS: transparent/opaque/baked PNG pixels, unchanged URLs, contain, zoom scrolling, keyboard navigation, focus return, narrow layout")
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
