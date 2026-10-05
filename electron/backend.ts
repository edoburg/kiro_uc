import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import * as path from "path";

export function getBackendLaunch(
  packaged: boolean,
  resourcesPath: string,
  projectRoot: string,
  platform = process.platform,
): { executable: string; args: string[]; cwd: string } {
  if (packaged) {
    const cwd = path.resolve(resourcesPath, "backend");
    return {
      executable: path.join(cwd, platform === "win32" ? "line-stamp-backend.exe" : "line-stamp-backend"),
      args: [],
      cwd,
    };
  }

  const root = path.resolve(projectRoot);
  const python = path.join(root, ".venv", platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return {
    executable: existsSync(python) ? python : platform === "win32" ? "python" : "python3",
    args: ["-m", "backend.run_server"],
    cwd: root,
  };
}

export function launchBackend(launch: ReturnType<typeof getBackendLaunch>): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.executable, launch.args, {
      cwd: launch.cwd,
      windowsHide: true,
      shell: false,
    });
    // Keep an error listener attached even after spawn to avoid uncaught errors.
    child.on("error", (error) => {
      console.error("[Backend] Process error:", error);
      reject(new Error(`バックエンドを起動できません: ${launch.executable}\n${error.message}`));
    });
    child.once("spawn", () => resolve(child));
  });
}
