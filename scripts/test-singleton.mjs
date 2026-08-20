// Integration test: two concurrent proxies share one backend; the backend
// exits after the grace period once both clients are gone.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import envPaths from "env-paths";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GRACE_MS = 3000;
const dataDir = envPaths("notebooklm-mcp", { suffix: "" }).data;
const infoPath = path.join(dataDir, "singleton.json");

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const ok = (msg) => console.error(`ok: ${msg}`);
const warn = (msg) => console.error(`warn: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Counts OS processes that look like our spawned backend (`--backend` on a
// `dist` entry point). Windows-only for now; on any other platform, or if
// enumeration itself fails, this returns null and the caller skips the
// assertion rather than failing the whole run over a tooling gap.
async function countBackendProcesses() {
  if (process.platform !== "win32") {
    warn("backend process count check skipped (non-Windows platform)");
    return null;
  }
  try {
    // Filter by process Name first (WMI-side), not just CommandLine: a plain
    // CommandLine-only filter would self-match this very enumeration command,
    // since its own command line necessarily contains the literal substrings
    // "--backend" and "dist" that it's searching for.
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      "@(Get-CimInstance -ClassName Win32_Process -Filter \"Name='node.exe'\" | " +
        "Where-Object { $_.CommandLine -like '*--backend*' -and $_.CommandLine -like '*dist*' }).Count",
    ]);
    const n = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(n) ? null : n;
  } catch (e) {
    warn(`backend process count check failed: ${e}`);
    return null;
  }
}

async function assertSingleBackend(label) {
  const count = await countBackendProcesses();
  if (count === null) return; // enumeration unsupported or failed; skip per plan
  if (count !== 1) fail(`${label}: expected exactly 1 backend process, found ${count}`);
  ok(`${label}: exactly 1 backend process running`);
}

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
await assertSingleBackend("scenario 2");

// 3. Both clients see the tools, concurrently.
const [ta, tb] = await Promise.all([a.listTools(), b.listTools()]);
if (!ta.tools.some((t) => t.name === "ask_question")) fail("surface-a misses ask_question");
if (!tb.tools.some((t) => t.name === "ask_question")) fail("surface-b misses ask_question");
if (JSON.parse(fs.readFileSync(infoPath, "utf-8")).pid !== info.pid) fail("backend changed pid mid-test");
ok(`both surfaces listed ${ta.tools.length} tools from the same backend`);

// 3b. Kill the backend; both surfaces must recover transparently by
// reconnecting and replaying the recorded handshake on a fresh session.
// listTools can race the reconnect and see a synthesized -32603 error
// (the SDK client surfaces it as a rejected promise) — retry once, the
// way a real client (Claude) would when told to retry.
async function listToolsWithRetry(client) {
  try {
    return await client.listTools();
  } catch {
    await sleep(2000);
    return client.listTools();
  }
}

process.kill(info.pid);
await sleep(1000);
const [ra, rb] = await Promise.all([listToolsWithRetry(a), listToolsWithRetry(b)]);
if (!ra.tools.length || !rb.tools.length) fail("a surface did not recover after backend death");
if (!ra.tools.some((t) => t.name === "ask_question")) fail("surface-a misses ask_question after recovery");
if (!rb.tools.some((t) => t.name === "ask_question")) fail("surface-b misses ask_question after recovery");
const reborn = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
if (reborn.pid === info.pid) fail("backend pid unchanged after kill?");
ok(`both surfaces recovered on new backend pid ${reborn.pid}`);
await assertSingleBackend("scenario 3b (post-recovery)");

// 4. Close both; the backend must exit within TTL-free time (clean DELETE) + grace.
// The proxy no longer forces process.exit() until its async cleanup and the
// event loop settle (see shutdownFromClient in proxy.ts), which resolved a
// previously-reproducible native libuv abort on very fast disconnects; the
// try/catch here is kept as a defensive fallback, not because of a known issue.
try { await a.close(); } catch { /* defensive: see proxy.ts shutdownFromClient */ }
try { await b.close(); } catch { /* defensive: see proxy.ts shutdownFromClient */ }
const deadline = Date.now() + GRACE_MS + 15_000;
let alive = true;
while (Date.now() < deadline && alive) {
  try { process.kill(reborn.pid, 0); await sleep(500); } catch { alive = false; }
}
if (alive) fail(`backend ${reborn.pid} still alive after grace`);
if (fs.existsSync(infoPath)) fail("singleton.json not removed on shutdown");
ok("backend exited after the last client left");

console.error("PASS: singleton integration");
process.exit(0);
