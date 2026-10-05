const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

if (!existsSync(python)) {
  console.error("Create .venv and install requirements.txt and requirements-build.txt before building.");
  process.exit(1);
}

const result = spawnSync(python, [
  "-m", "PyInstaller",
  "--noconfirm", "--clean", "--onedir", "--console", "--noupx",
  "--name", "line-stamp-backend",
  "--distpath", path.join(root, "dist-backend"),
  "--workpath", path.join(root, "build-backend", "work"),
  "--specpath", path.join(root, "build-backend"),
  "--paths", root,
  // Uvicorn protocols and OS keyring backends are loaded dynamically.
  "--collect-all", "uvicorn",
  "--collect-all", "keyring",
  "--collect-all", "playwright",
  path.join(root, "backend", "run_server.py"),
], { cwd: root, stdio: "inherit", windowsHide: true });

if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
