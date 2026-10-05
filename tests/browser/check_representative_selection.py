"""メイン／タブ画像の元画像選択を実ブラウザーと実際の画像処理・ZIP出力で検証する。

実行: .venv/Scripts/python.exe tests/browser/check_representative_selection.py

- 内容の異なる8枚のPNGを ImageProcessorService で実際に変換する（画像生成APIは呼ばない）
- 編集画面でメインに3枚目・タブに5枚目を選び、表示が派生画像であることを確認する
- 画面が作ったZIP要求を FastAPI /export（TestClient）へ渡し、main.png / tab.png の
  バイト列と 01.png〜08.png の順序を確認する
- 選択画像の削除で未選択になり出力が無効になることを確認する
LINEへの送信は行わない。結果は .pytest_cache/representative-selection/ に保存する。
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
from zipfile import ZipFile

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import backend.main as main_module  # noqa: E402
from backend.services.image_processor_service import ImageProcessorService  # noqa: E402
from backend.services.log_service import LogService  # noqa: E402


def _data_url(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def _make_sources(output: Path) -> list[Path]:
    """番号と端の文字を描いた、画像ごとに色の異なる透過PNGを作る。"""
    font = ImageFont.load_default(size=180)
    small = ImageFont.load_default(size=70)
    paths = []
    for index in range(8):
        image = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        color = (40 + index * 25, 120, 255 - index * 25, 255)
        draw.ellipse((212, 212, 812, 812), fill=color)
        draw.text((440, 400), str(index + 1), fill=(255, 255, 255, 255), font=font)
        # 中央クロップで切れる位置（左右端）に文字を置き、派生画像の確認に使う
        draw.text((10, 470), "EDGE", fill=(20, 20, 20, 255), font=small)
        path = output / f"source-{index}.png"
        image.save(path, format="PNG")
        paths.append(path)
    return paths


def main() -> None:
    output = ROOT / ".pytest_cache" / "representative-selection"
    output.mkdir(parents=True, exist_ok=True)
    for stale in output.glob("*"):
        if stale.is_file():
            stale.unlink()

    processor = ImageProcessorService()
    fixtures = []
    processed_sets = []
    for source in _make_sources(output):
        processed = asyncio.run(processor.process_image(str(source)))
        processed_sets.append(processed)
        fixtures.append(
            {
                "sourcePath": str(source),
                "originalDataUrl": _data_url(source),
                "processed": main_module.to_api_payload(processed),
            }
        )
    (output / "fixtures.json").write_text(json.dumps(fixtures), encoding="utf-8")

    with (output / "server.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            ["node", "tests/browser/review-server.mjs"],
            cwd=ROOT,
            stdout=log,
            stderr=log,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            url = "http://127.0.0.1:5198/tests/browser/representative-selection.html"
            for _ in range(100):
                try:
                    urllib.request.urlopen(url, timeout=1).close()
                    break
                except OSError:
                    time.sleep(0.1)
            with sync_playwright() as playwright:
                options: dict = {"headless": True}
                if not Path(playwright.chromium.executable_path).exists():
                    edge = Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Microsoft/Edge/Application/msedge.exe"
                    options["executable_path"] = str(edge)
                browser = playwright.chromium.launch(**options)
                page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
                errors: list[str] = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(url)

                page.get_by_role("button", name="スタンプセットを編集する").click()
                summary = page.get_by_role("region", name="メイン画像とトークルームタブ画像")
                summary.wait_for()
                page.get_by_label("タイトル（1〜40文字）").fill("選択検証")

                # 初期値は先頭画像
                initial_main = summary.get_by_alt_text("選択中のメイン画像（スタンプ 1）")
                assert initial_main.get_attribute("src") == fixtures[0]["processed"]["mainImageDataUrl"]

                page.get_by_role("button", name="スタンプ 3 をメイン画像に使う").click()
                page.get_by_role("button", name="スタンプ 5 をタブ画像に使う").click()
                main_img = summary.get_by_alt_text("選択中のメイン画像（スタンプ 3）")
                tab_img = summary.get_by_alt_text("選択中のトークルームタブ画像（スタンプ 5）")
                assert main_img.get_attribute("src") == fixtures[2]["processed"]["mainImageDataUrl"]
                assert tab_img.get_attribute("src") == fixtures[4]["processed"]["thumbnailDataUrl"]
                assert main_img.get_attribute("src") != fixtures[2]["originalDataUrl"]
                assert main_img.evaluate("node => node.naturalWidth") == 240
                assert tab_img.evaluate("node => [node.naturalWidth, node.naturalHeight]") == [96, 74]
                assert page.get_by_role("button", name="スタンプ 3 をメイン画像に使う").get_attribute("aria-pressed") == "true"
                summary.screenshot(path=str(output / "summary.png"))
                page.screenshot(path=str(output / "editor-wide.png"), full_page=True)

                checks = page.evaluate("window.__checks")
                assert len(checks["processCalls"]) == 8, checks["processCalls"]
                assert checks["generateCalls"] == 0

                page.get_by_role("button", name="エクスポート（ZIP保存）").click()
                page.wait_for_function("window.__checks.exportRequests.length === 1")
                export_request = page.evaluate("window.__checks.exportRequests[0]")
                assert len(page.evaluate("window.__checks.processCalls")) == 8

                # 画面が作った要求を実際のFastAPI /export へ渡してZIPを検証する
                main_module.log_service = LogService(output / "logs")
                client = TestClient(main_module.app)
                response = client.post(
                    "/export",
                    json={
                        "stampSet": export_request["stampSet"],
                        "outputDirectory": str(output / "zip"),
                    },
                )
                assert response.status_code == 200, response.text
                with ZipFile(response.json()["zipPath"]) as archive:
                    assert archive.read("main.png") == Path(processed_sets[2].main_image_path).read_bytes()
                    assert archive.read("tab.png") == Path(processed_sets[4].thumbnail_path).read_bytes()
                    assert archive.read("main.png") != Path(processed_sets[0].main_image_path).read_bytes()
                    for index, processed in enumerate(processed_sets):
                        assert archive.read(f"{index + 1:02d}.png") == Path(processed.stamp_path).read_bytes()
                    main_png = Image.open(io.BytesIO(archive.read("main.png")))
                    tab_png = Image.open(io.BytesIO(archive.read("tab.png")))
                    assert main_png.size == (240, 240) and tab_png.size == (96, 74)

                # 選択画像の削除: 確認後に未選択となり、出力できない
                page.once("dialog", lambda dialog: dialog.accept())
                page.get_by_role("button", name="スタンプ画像 3 を削除").click()
                summary.get_by_text("メイン画像が選択されていません").wait_for()
                assert page.get_by_role("button", name="エクスポート（ZIP保存）").is_disabled()
                assert summary.get_by_alt_text("選択中のトークルームタブ画像（スタンプ 4）").get_attribute("src") == fixtures[4]["processed"]["thumbnailDataUrl"]
                page.screenshot(path=str(output / "after-delete.png"), full_page=True)

                page.set_viewport_size({"width": 390, "height": 800})
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                page.screenshot(path=str(output / "editor-narrow.png"), full_page=True)
                assert not errors, errors
                browser.close()
                print(
                    "PASS: initial first image, main=3/tab=5 derived previews (240x240 / 96x74), "
                    "no generate/reprocess on select, ZIP main.png/tab.png bytes and 01-08 order via real /export, "
                    "delete clears selection and disables export, narrow layout"
                )
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
