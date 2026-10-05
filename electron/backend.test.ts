// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as path from "path";
import { getBackendLaunch, launchBackend } from "./backend";

describe("backend process launch", () => {
  it("launches the packaged exe outside app.asar using an absolute path, including spaces", () => {
    const resources = path.resolve("Test Install 日本語", "resources");
    const launch = getBackendLaunch(true, resources, path.resolve("app.asar"), "win32");
    expect(launch).toEqual({
      executable: path.join(resources, "backend", "line-stamp-backend.exe"),
      args: [],
      cwd: path.join(resources, "backend"),
    });
    expect(path.isAbsolute(launch.executable)).toBe(true);
  });

  it("uses the source entry point for development", () => {
    const launch = getBackendLaunch(false, "unused", process.cwd());
    expect(launch.args).toEqual(["-m", "backend.run_server"]);
    expect(launch.cwd).toBe(process.cwd());
    expect(launch.executable).toContain("python");
  });

  it("rejects a missing executable without an uncaught spawn error", async () => {
    const launch = getBackendLaunch(true, path.resolve("missing-test-resources"), process.cwd());
    await expect(launchBackend(launch)).rejects.toThrow("バックエンドを起動できません");
  });

  it("returns a running child that can be stopped", async () => {
    const child = await launchBackend({
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
    });
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    expect(child.pid).toBeDefined();
    child.kill();
    await closed;
  });
});
