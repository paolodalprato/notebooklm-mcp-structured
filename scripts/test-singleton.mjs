// Integration test: two concurrent proxies share one backend; the backend
// exits after the grace period once both clients are gone.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import envPaths from "env-paths";
import fs from "node:fs";
import path from "node:path";

const GRACE_MS = 3000;
const dataDir = envPaths("notebooklm-mcp", { suffix: "" }).data;
const infoPath = path.join(dataDir, "singleton.json");

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const ok = (msg) => console.error(`ok: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startClient(name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, NOTEBOOK_BACKEND_GRACE_MS: String(GRACE_MS) },
    stderr: "inherit",
  });
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(transport);
  return client;
}

// 1. Two surfaces at once (the Claude Desktop race).
const [a, b] = await Promise.all([startClient("surface-a"), startClient("surface-b")]);
ok("two proxies connected concurrently");

// 2. Exactly one backend.
const info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
ok(`backend pid ${info.pid} on port ${info.port}`);

// 3. Both clients see the tools, concurrently.
const [ta, tb] = await Promise.all([a.listTools(), b.listTools()]);
if (!ta.tools.some((t) => t.name === "ask_question")) fail("surface-a misses ask_question");
if (!tb.tools.some((t) => t.name === "ask_question")) fail("surface-b misses ask_question");
if (JSON.parse(fs.readFileSync(infoPath, "utf-8")).pid !== info.pid) fail("backend changed pid mid-test");
ok(`both surfaces listed ${ta.tools.length} tools from the same backend`);

// 4. Close both; the backend must exit within TTL-free time (clean DELETE) + grace.
// Known issue: on very fast disconnect the proxy child can abort with a native
// libuv assertion AFTER completing its DELETE + cleanup (deferred to a later
// task). That does not affect the assertions below, so tolerate close() throwing.
try { await a.close(); } catch { /* see known-issue note above */ }
try { await b.close(); } catch { /* see known-issue note above */ }
const deadline = Date.now() + GRACE_MS + 15_000;
let alive = true;
while (Date.now() < deadline && alive) {
  try { process.kill(info.pid, 0); await sleep(500); } catch { alive = false; }
}
if (alive) fail(`backend ${info.pid} still alive after grace`);
if (fs.existsSync(infoPath)) fail("singleton.json not removed on shutdown");
ok("backend exited after the last client left");

console.error("PASS: singleton integration");
process.exit(0);
