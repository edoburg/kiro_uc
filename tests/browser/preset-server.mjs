import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const directory = resolve(process.argv[2]);
await mkdir(directory, { recursive: true });
const bundle = resolve(directory, "repository.mjs");
await build({ entryPoints: ["electron/generationPresets.ts"], bundle: true, platform: "node", format: "esm", outfile: bundle });
const { GenerationPresetRepository } = await import(pathToFileURL(bundle).href);
const repository = new GenerationPresetRepository(resolve(directory, "library"));
const handler = async (request, response) => {
  try {
    let text = "";
    for await (const chunk of request) text += chunk;
    const input = text ? JSON.parse(text) : undefined;
    let result;
    switch (request.url) {
      case "/list": result = await repository.list(); break;
      case "/load": result = await repository.load(input); break;
      case "/save": result = await repository.save(input); break;
      case "/delete": await repository.delete(input); result = null; break;
      default: throw new Error("不明な検証操作です。");
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = 400;
    response.end(JSON.stringify({ message: error.message }));
  }
};
const server = await createServer({ configFile: false, plugins: [react(), {
  name: "preset-test-api",
  configureServer(server) { server.middlewares.use("/preset-test-api", handler); },
}], server: { host: "127.0.0.1", port: 5199, strictPort: true } });
await server.listen();
console.log("Preset test server ready");
