const { readEventFromStdin } = require("./hook-utils.cjs");

function collectText(value, key = "") {
  if (typeof value === "string") {
    return key === "" ? value : `${key}=${value}\n${value}`;
  }
  if (value === null || typeof value !== "object") {
    return key === "" ? String(value) : `${key}=${String(value)}`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => collectText(item, key)).join("\n");
  }
  return Object.entries(value)
    .map(([childKey, childValue]) => collectText(childValue, childKey))
    .join("\n");
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /["']?(?:api[_-]?key|password|secret|access[_-]?token)["']?\s*[:=]\s*["'][^"'\s${}<]{8,}["']/i,
];

function containsSecret(event) {
  const input = collectText(event.tool_input ?? event.toolInput ?? event);
  return secretPatterns.some((pattern) => pattern.test(input));
}

function main() {
  const event = readEventFromStdin();
  if (containsSecret(event)) {
    console.error(
      "認証情報または秘密鍵と思われる平文を検出したため、書き込みをブロックしました。環境変数またはOSキーチェーンを使用してください。",
    );
    process.exit(2);
  }

  console.log("セキュリティチェックに成功しました。");
}

if (require.main === module) {
  main();
}

module.exports = { collectText, containsSecret };
