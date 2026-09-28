const {
  npmCommand,
  pythonCommand,
  readEventFromStdin,
  run,
} = require("./hook-utils.cjs");

readEventFromStdin();

run(npmCommand(), ["run", "test:run"], {
  shell: process.platform === "win32",
});
run(pythonCommand(), ["-m", "pytest", "tests", "-x", "-q"]);

console.log("Vitestとpytestに成功しました。");
