// Smoke test: spawn the built server, initialize, list tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = { ...process.env, ...JSON.parse(process.env.SMOKE_ENV ?? "{}") };
const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env, stderr: "inherit" });
const client = new Client({ name: "smoke-client", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
if (!tools.some((t) => t.name === "ask_question")) {
  console.error("FAIL: ask_question tool missing"); process.exit(1);
}
console.error(`OK: ${tools.length} tools via ${env.NOTEBOOK_SINGLETON === "false" ? "direct" : "default"} mode`);
await client.close();
process.exit(0);
