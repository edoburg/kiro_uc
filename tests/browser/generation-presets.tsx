import React from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import "../../src/styles.css";

async function call(operation: string, input?: unknown) {
  const response = await fetch(`/preset-test-api/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message);
  return value;
}
const generationCalls: unknown[] = [];
Object.defineProperty(window, "generationCalls", { value: generationCalls });
Object.defineProperty(window, "api", { value: {
  generationPresets: { list: () => call("list"), load: (id: string) => call("load", id), save: (input: unknown) => call("save", input), delete: (id: string) => call("delete", id) },
  config: { get: async () => ({ aiEngine: "openai", outputDirectory: "", openaiModel: "gpt-image-2.5-flare", openaiQuality: "low", sdEndpoint: "" }) },
  credential: { get: async () => ({ configured: true }) },
  image: { generate: async (request: unknown) => { generationCalls.push(request); return { streamId: "mock" }; } },
  onGenerateProgress: () => () => {},
} });
createRoot(document.getElementById("root")!).render(<App />);
