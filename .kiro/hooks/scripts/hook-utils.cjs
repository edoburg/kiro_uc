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

/**
 * コマンドを実行し、終了コードと stdout/stderr を文字列で返す（プロセスは終了させない）。
 * 呼び出し側で結果のログ記録や exit コード制御を行うために使う。
 */
function runCapture(command, args, options = {}) {
  const useWindowsShell = options.shell === true && process.platform === "win32";
  const executable = useWindowsShell ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs = useWindowsShell
    ? ["/d", "/s", "/c", [command, ...args].join(" ")]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error) {
    return {
      status: 1,
      stdout: "",
      stderr: `${command} を起動できません: ${result.error.message}`,
    };
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Hook 実行結果をワークスペース内のログファイルへ追記する。
 * 認証情報などは含めない前提の、コマンド出力のみを記録する。
 */
function appendHookLog(logFileName, text) {
  const logDir = path.join(".kiro", "hooks", "logs");
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString();
    fs.appendFileSync(
      path.join(logDir, logFileName),
      `\n===== ${stamp} =====\n${text}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(`Hookログの書き込みに失敗しました: ${error.message}`);
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
  appendHookLog,
  npmCommand,
  npxCommand,
  parseEvent,
  pythonCommand,
  readEventFromStdin,
  run,
  runCapture,
};
