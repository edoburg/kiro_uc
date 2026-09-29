const path = require("node:path");
const {
  appendHookLog,
  npmCommand,
  npxCommand,
  pythonCommand,
  readEventFromStdin,
  runCapture,
} = require("./hook-utils.cjs");

const LOG_FILE = "lint-on-save.log";

const event = readEventFromStdin();
const savedPath = String(
  event.file_path ?? event.filePath ?? event.file ?? event.path ?? "",
);
const extension = path.extname(savedPath).toLowerCase();

/** 実行するステップ（ラベルとコマンド）の一覧を組み立てる。 */
function buildSteps() {
  if (extension === ".py") {
    const pyArgs =
      savedPath !== ""
        ? ["-m", "py_compile", savedPath]
        : ["-m", "compileall", "-q", "backend", "tests"];
    return [
      { label: "Python構文チェック", command: pythonCommand(), args: pyArgs, options: {} },
    ];
  }
  const shellOptions = { shell: process.platform === "win32" };
  return [
    { label: "ESLint", command: npmCommand(), args: ["run", "lint"], options: shellOptions },
    { label: "TypeScript型チェック", command: npxCommand(), args: ["tsc", "--noEmit"], options: shellOptions },
  ];
}

const target = savedPath !== "" ? savedPath : "(パス不明)";
const steps = buildSteps();
const failures = [];
const logSections = [`対象ファイル: ${target}`];

for (const step of steps) {
  const result = runCapture(step.command, step.args, step.options);
  const combined = [result.stdout, result.stderr]
    .filter((chunk) => chunk && chunk.trim() !== "")
    .join("\n")
    .trim();
  const outcome = result.status === 0 ? "成功" : `失敗 (exit ${result.status})`;
  logSections.push(
    `[${step.label}] ${outcome}\n${combined === "" ? "(出力なし)" : combined}`,
  );
  if (result.status !== 0) {
    failures.push({ label: step.label, output: combined });
  }
}

// 成功・失敗にかかわらず Logs 用ファイルへ記録する。
appendHookLog(LOG_FILE, logSections.join("\n\n"));

if (failures.length > 0) {
  // PostFileSave はブロック不可トリガーのため exit 2 に特別な意味はない。
  // IDE では非ゼロ終了時に stderr がエージェントへ送られ、Hook エラーとして通知される。
  const report = failures
    .map((failure) => {
      const body = failure.output === "" ? "(出力なし)" : failure.output;
      return `【${failure.label} 失敗】\n${body}`;
    })
    .join("\n\n");
  console.error(
    `Lint on Save: 静的検査に失敗しました（対象: ${target}）。\n\n${report}\n\n` +
      `詳細ログ: .kiro/hooks/logs/${LOG_FILE}`,
  );
  process.exit(1);
}

const successLabels = steps.map((step) => step.label).join(" / ");
console.log(`Lint on Save: ${successLabels} に成功しました（対象: ${target}）。`);
