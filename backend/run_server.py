"""Entry point for the bundled backend (also runnable with -m backend.run_server)."""

import multiprocessing

import uvicorn

from backend.main import app


if __name__ == "__main__":
    multiprocessing.freeze_support()
    # Pass the app object so PyInstaller sees the import during analysis.
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8765,
        access_log=False,
        loop="asyncio",
        http="h11",
    )
