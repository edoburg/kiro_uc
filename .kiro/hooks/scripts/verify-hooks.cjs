const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parseEvent } = require("./hook-utils.cjs");
const { containsSecret } = require("./security-check-on-write.cjs");

const projectRoot = path.resolve(__dirname, "../../..");
const hookDirectory = path.join(projectRoot, ".kiro", "hooks");

const expectedHooks = {
  "lint-on-save.json": {
    trigger: "PostFileSave",
    matcher: "\\.(ts|tsx|py)$",
    actionType: "command",
  },
  "run-tests-after-task.json": {
    trigger: "PostTaskExec",
    actionType: "command",
  },
  "security-check-on-write.json": {
    trigger: "PreToolUse",
    matcher: "write",
    actionType: "command",
  },
  "session-start-reminder.json": {
    trigger: "SessionStart",
    actionType: "agent",
  },
};

for (const [fileName, expected] of Object.entries(expectedHooks)) {
  const config = JSON.parse(
    fs.readFileSync(path.join(hookDirectory, fileName), "utf8"),
  );
  assert.equal(config.version, "v1", `${fileName}: version`);
  assert.equal(config.hooks.length, 1, `${fileName}: hooks`);

  const hook = config.hooks[0];
  assert.equal(hook.trigger, expected.trigger, `${fileName}: trigger`);
  assert.equal(hook.action.type, expected.actionType, `${fileName}: action`);
  assert.equal(hook.enabled, true, `${fileName}: enabled`);
  assert.equal(hook.matcher, expected.matcher, `${fileName}: matcher`);
  assert.equal(hook.action.timeout, undefined, `${fileName}: action.timeout`);
  if (hook.action.type === "command") {
    assert.equal(typeof hook.timeout, "number", `${fileName}: timeout`);
  }
}

const lintMatcher = new RegExp(expectedHooks["lint-on-save.json"].matcher);
assert.equal(lintMatcher.test("src/App.tsx"), true);
assert.equal(lintMatcher.test("backend/models.py"), true);
assert.equal(lintMatcher.test("src/styles.css"), false);

const safeWrite = {
  tool_name: "write",
  tool_input: { path: "src/example.ts", content: "const value = 1;" },
};
assert.equal(containsSecret(safeWrite), false);

const blockedWrite = {
  tool_name: "write",
  tool_input: {
    path: "src/example.ts",
    content: `api_key = "sk-${"a".repeat(24)}"`,
  },
};
assert.equal(containsSecret(blockedWrite), true);

assert.throws(() => parseEvent("not-json"), SyntaxError);

console.log("Hookスキーマ、matcher、成功・ブロック・失敗の検証に成功しました。");

if (process.argv.includes("--full")) {
  for (const [scriptName, event] of [
    ["lint-on-save.cjs", { file_path: "src/App.tsx" }],
    ["lint-on-save.cjs", { file_path: "backend/models.py" }],
    ["run-tests-after-task.cjs", { hook_event_name: "postTaskExec" }],
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, scriptName)], {
      cwd: projectRoot,
      input: JSON.stringify(event),
      stdio: ["pipe", "inherit", "inherit"],
    });
    assert.equal(result.status, 0, `${scriptName} exited with ${result.status}`);
  }
  console.log("Lint、型チェック、Vitest、pytestの完全検証に成功しました。");
}
