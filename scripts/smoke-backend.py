"""Check the packaged backend without Python on PATH or access to project sources."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

from PIL import Image


def request(route: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(
        f"http://127.0.0.1:8765{route}",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urlopen(req, timeout=2) as response:
        return json.load(response)


def main() -> None:
    executable = Path(sys.argv[1]).resolve()
    if not executable.is_file():
        raise FileNotFoundError(executable)
    try:
        request("/health")
    except URLError:
        pass
    else:
        raise RuntimeError("Port 8765 is already in use; close the app before testing.")

    work = Path(__file__).resolve().parents[1] / "build-backend"
    work.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="smoke 日本語 ", dir=work) as temp:
        env = os.environ.copy()
        env["PATH"] = str(Path(os.environ["SystemRoot"]) / "System32")
        env.pop("PYTHONPATH", None)
        env.pop("PYTHONHOME", None)
        # Isolate config and logs from the user's real application data.
        env["USERPROFILE"] = temp
        log_path = Path(temp) / "backend.log"
        with log_path.open("w+", encoding="utf-8") as log:
            child = subprocess.Popen(
                [str(executable)], cwd=temp, env=env,
                stdout=log, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            try:
                for _ in range(60):
                    if child.poll() is not None:
                        raise RuntimeError(f"Backend exited: {child.returncode}")
                    try:
                        request("/health")
                        break
                    except URLError:
                        time.sleep(0.5)
                else:
                    raise RuntimeError("Backend did not become ready")
                request("/config")
                credential = request("/config/credential/packaging-smoke-test")
                assert credential["configured"] is False
                source = Path(temp) / "test image.png"
                Image.new("RGBA", (370, 320), (20, 40, 60, 255)).save(source)
                result = request("/process", {"sourcePath": str(source)})
                assert result["validation"]["passed"] is True
                for key in ("stampPath", "mainImagePath", "thumbnailPath"):
                    assert Path(result[key]).is_file(), key
                print("PASS: bundled backend health/config/Windows keyring/image processing with no Python on PATH")
            except Exception:
                log.flush()
                print(log_path.read_text(encoding="utf-8"), file=sys.stderr)
                raise
            finally:
                child.terminate()
                child.wait(timeout=10)
        print("PASS: backend process stopped")


if __name__ == "__main__":
    main()
