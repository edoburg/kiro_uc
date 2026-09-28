const path = require("node:path");
const {
  npmCommand,
  npxCommand,
  pythonCommand,
  readEventFromStdin,
  run,
} = require("./hook-utils.cjs");

const event = readEventFromStdin();
const savedPath = String(
  event.file_path ?? event.filePath ?? event.file ?? event.path ?? "",
);
const extension = path.extname(savedPath).toLowerCase();

if (extension === ".py") {
  if (savedPath !== "") {
    run(pythonCommand(), ["-m", "py_compile", savedPath]);
  } else {
    run(pythonCommand(), ["-m", "compileall", "-q", "backend", "tests"]);
  }
  console.log("Python構文チェックに成功しました。");
} else {
  const shellOptions = { shell: process.platform === "win32" };
  run(npmCommand(), ["run", "lint"], shellOptions);
  run(npxCommand(), ["tsc", "--noEmit"], shellOptions);
  console.log("ESLintとTypeScript型チェックに成功しました。");
}
