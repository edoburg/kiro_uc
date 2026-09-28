const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function parseEvent(input) {
  const normalizedInput = input.trim();
  if (normalizedInput === "") {
    return {};
  }

  return JSON.parse(normalizedInput);
}

function readEventFromStdin() {
  const input = fs.readFileSync(0, "utf8");

  try {
    return parseEvent(input);
  } catch (error) {
    console.error(`Kiro Hookから受け取ったJSONを解析できません: ${error.message}`);
    process.exit(1);
  }
}

function run(command, args, options = {}) {
  const useWindowsShell = options.shell === true && process.platform === "win32";
  const executable = useWindowsShell ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs = useWindowsShell
    ? ["/d", "/s", "/c", [command, ...args].join(" ")]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`${command} を起動できません: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function pythonCommand() {
  const candidates = process.platform === "win32"
    ? [path.join(".venv", "Scripts", "python.exe")]
    : [path.join(".venv", "bin", "python")];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === "win32" ? "python.exe" : "python3";
}

module.exports = {
  npmCommand,
  npxCommand,
  parseEvent,
  pythonCommand,
  readEventFromStdin,
  run,
};
