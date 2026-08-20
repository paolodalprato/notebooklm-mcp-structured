# Singleton Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One backend process per machine owns the browser; the stdio servers Claude Desktop spawns become transparent proxies to it, so the Chat and Cowork surfaces can query notebooks concurrently.

**Architecture:** The same executable takes one of three roles: proxy (default; pipes JSON-RPC between its stdio and the backend over localhost Streamable HTTP), backend (internal `--backend` flag; the full existing server on HTTP, exactly one per machine, discovered via `singleton.json` + spawn lock in the data dir), direct (`NOTEBOOK_SINGLETON=false`; today's stdio behavior). Backend exits ~60 s after its last client disconnects.

**Tech Stack:** TypeScript ES2022 / Node16 modules, `@modelcontextprotocol/sdk` 1.30.0 (`StreamableHTTPServerTransport`, `StreamableHTTPClientTransport`, `StdioServerTransport`), `node:http`, `node:test` via `tsx` for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-20-singleton-backend-design.md`

## Global Constraints

- Node >= 18; no new npm dependencies (SDK 1.30.0 already installed has both HTTP transports).
- ESM with `.js` extensions on relative imports (`"module": "Node16"`).
- Logging via `log.*` from `src/utils/logger.ts`; comments in English; kebab-case filenames.
- stdout of proxy and direct modes must stay pure JSON-RPC — all human output on stderr (existing logger already does this).
- Backend HTTP binds `127.0.0.1` only; every request requires `Authorization: Bearer <token>`.
- `tsconfig` is `strict` with `noUnusedLocals`/`noUnusedParameters` — code must compile clean.
- Windows is the primary target; nothing may break Linux/macOS (`env-paths` layout).
- Existing behavior of tools, auth, sessions, and selectors must not change.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/config.ts` (modify) | `SERVER_VERSION`, `singletonEnabled`, `backendGraceMs`, `logsDir` |
| `src/server-core.ts` (create) | `createServerCore()` (managers, once per process) + `createMcpServer(core)` (one MCP `Server` per transport) — extracted from `index.ts` |
| `src/index.ts` (modify) | Role dispatch only: `config` CLI / `--backend` / direct / proxy |
| `src/singleton/registry.ts` (create) | `singleton.json` + `singleton.lock`: atomic write, validated read, pid liveness, stale-lock stealing |
| `src/singleton/backend.ts` (create) | `runBackend()`: HTTP server, token auth, MCP sessions, liveness sweeper, grace shutdown, log file |
| `src/singleton/spawn.ts` (create) | `ensureBackend()`: discovery, health ping, version skew, detached spawn, wait-ready |
| `src/singleton/proxy.ts` (create) | `runProxy()`: stdio⇄HTTP piping, handshake record/replay, heartbeat, reconnect, synthesized errors |
| `src/singleton/registry.test.ts` (create) | Unit tests (`node:test`) |
| `scripts/smoke-client.mjs` (create) | One SDK client → `initialize` + `tools/list` smoke test |
| `scripts/test-singleton.mjs` (create) | Integration: two clients, one backend, crash recovery, grace exit |

---

### Task 1: Config additions and version constant

**Files:**
- Modify: `src/config.ts`
- Modify: `src/index.ts` (use `SERVER_VERSION` in the two places `"1.0.0"` is hardcoded: the `Server` info object and log lines)
- Modify: `package.json` (version `1.0.0` → `1.1.0`)
- Modify: `tsconfig.json` (exclude test files from the build)

**Interfaces:**
- Produces: `SERVER_VERSION: string` (= `"1.1.0"`), `CONFIG.singletonEnabled: boolean` (default `true`, env `NOTEBOOK_SINGLETON`), `CONFIG.backendGraceMs: number` (default `60000`, env `NOTEBOOK_BACKEND_GRACE_MS`), `CONFIG.logsDir: string` (`path.join(paths.data, "logs")`, created by `ensureDirectories()`).

- [ ] **Step 1: Edit `src/config.ts`**

Add below the `NOTEBOOK_HOST` export:

```ts
/** Single source of truth for the server version (package.json mirrors it). */
export const SERVER_VERSION = "1.1.0";
```

Add to the `Config` interface, in the Paths block: `logsDir: string;` and a new block:

```ts
  // Singleton backend
  singletonEnabled: boolean;
  backendGraceMs: number;
```

Add to `DEFAULTS`: `logsDir: path.join(paths.data, "logs"),` and

```ts
  // Singleton backend
  singletonEnabled: true,
  backendGraceMs: 60000,
```

Add to `applyEnvOverrides`:

```ts
    singletonEnabled: parseBoolean(process.env.NOTEBOOK_SINGLETON, config.singletonEnabled),
    backendGraceMs: parseInteger(process.env.NOTEBOOK_BACKEND_GRACE_MS, config.backendGraceMs),
```

Add `CONFIG.logsDir` to the `dirs` array in `ensureDirectories()`.

- [ ] **Step 2: Edit `src/index.ts` and `package.json`**

In `index.ts`: import `SERVER_VERSION` from `./config.js`; replace `version: "1.0.0"` in the `Server` constructor and the `Version: 1.0.0` log line with it. Leave the banner text alone. In `package.json`: `"version": "1.1.0"`.

- [ ] **Step 3: Edit `tsconfig.json`**

```json
  "exclude": ["node_modules", "dist", "Old_Python_Vesion", "src/**/*.test.ts"]
```

- [ ] **Step 4: Build and verify**

Run: `npm run build && node -e "console.log(require('./package.json').version)"`
Expected: build clean, prints `1.1.0`.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/index.ts package.json tsconfig.json
git commit -m "Add singleton config knobs and a single version constant"
```

---

### Task 2: Extract the server core from index.ts

**Files:**
- Create: `src/server-core.ts`
- Modify: `src/index.ts` (becomes role dispatch + direct mode; behavior unchanged for now)
- Create: `scripts/smoke-client.mjs`

**Interfaces:**
- Produces:
  - `interface ServerCore { authManager: AuthManager; sessionManager: SessionManager; library: NotebookLibrary; settingsManager: SettingsManager; toolHandlers: ToolHandlers; resourceHandlers: ResourceHandlers; toolDefinitions: Tool[]; }`
  - `function createServerCore(): ServerCore` — instantiates everything exactly once per process.
  - `function createMcpServer(core: ServerCore): Server` — a fresh MCP `Server` wired to the shared core; caller connects it to a transport.
  - `async function runDirect(): Promise<void>` (exported from `index.ts` is fine, it stays there).

This is a pure refactor: move code, do not change it.

- [ ] **Step 1: Create `src/server-core.ts`**

Move from `index.ts`: all manager/handler imports, the manager construction from the `NotebookLMMCPServer` constructor into `createServerCore()`, and the whole `setupHandlers()` body into `createMcpServer(core)`. Shape:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { /* schemas, Tool */ } from "@modelcontextprotocol/sdk/types.js";
// ... manager imports, SERVER_VERSION, log ...

export interface ServerCore { /* as in Interfaces above */ }

export function createServerCore(): ServerCore {
  const authManager = new AuthManager();
  const sessionManager = new SessionManager(authManager);
  const library = new NotebookLibrary();
  const settingsManager = new SettingsManager();
  const toolHandlers = new ToolHandlers(sessionManager, authManager, library);
  const resourceHandlers = new ResourceHandlers(library);
  const toolDefinitions = settingsManager.filterTools(buildToolDefinitions(library) as Tool[]);
  return { authManager, sessionManager, library, settingsManager, toolHandlers, resourceHandlers, toolDefinitions };
}

export function createMcpServer(core: ServerCore): Server {
  const server = new Server(
    { name: "notebooklm-mcp", version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} } }
  );
  core.resourceHandlers.registerHandlers(server);
  // ... the current ListTools / prompts / CallTool handlers verbatim,
  //     with `this.toolDefinitions` → `core.toolDefinitions`,
  //     `this.toolHandlers` → `core.toolHandlers`, `this.server` → `server`.
  return server;
}
```

The `prompts` array and every `case` of the tool switch move over verbatim.

- [ ] **Step 2: Rewrite `src/index.ts`**

Keep: shebang, banner, CLI `config` handling, shutdown handlers (now closing over a `ServerCore`). New body:

```ts
async function runDirect(): Promise<void> {
  const core = createServerCore();
  installShutdownHandlers(core); // SIGINT/SIGTERM/uncaught → core.toolHandlers.cleanup() → exit
  const server = createMcpServer(core);
  await server.connect(new StdioServerTransport());
  log.success("✅ MCP Server connected via stdio");
  // ... existing tool-list logging, using core.toolDefinitions ...
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] === "config") { /* unchanged */ }
  printBanner();
  await runDirect(); // roles --backend / proxy arrive in Tasks 4 and 6
}
```

`installShutdownHandlers(core)` is the current `setupShutdownHandlers` with `this.toolHandlers` → `core.toolHandlers` and `this.server.close()` dropped (each role closes its own transports; process.exit covers the rest).

- [ ] **Step 3: Create `scripts/smoke-client.mjs`**

```js
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
```

- [ ] **Step 4: Build and run the smoke test**

Run: `npm run build && node scripts/smoke-client.mjs`
Expected: `OK: <n> tools ...` and clean exit. (Default mode is still direct at this point.)

- [ ] **Step 5: Commit**

```bash
git add src/server-core.ts src/index.ts scripts/smoke-client.mjs
git commit -m "Extract the server core so several transports can share it"
```

---

### Task 3: Singleton registry with unit tests

**Files:**
- Create: `src/singleton/registry.ts`
- Test: `src/singleton/registry.test.ts`
- Modify: `package.json` (add script `"test:unit": "tsx --test src/singleton/*.test.ts"`)

**Interfaces:**
- Produces:
  - `interface SingletonInfo { port: number; token: string; pid: number; version: string; startedAt: string; }`
  - `infoPath(dataDir: string): string` / `lockPath(dataDir: string): string`
  - `isPidAlive(pid: number): boolean`
  - `readInfo(dataDir: string): Promise<SingletonInfo | null>` — `null` on absent/corrupt/wrong-shape
  - `writeInfoAtomic(dataDir: string, info: SingletonInfo): Promise<void>` — temp + rename
  - `removeInfo(dataDir: string): Promise<void>` — never throws
  - `acquireSpawnLock(dataDir: string): Promise<boolean>` — `wx` create; steals a lock whose holder pid is dead
  - `releaseSpawnLock(dataDir: string): Promise<void>` — never throws

- [ ] **Step 1: Write the failing tests (`src/singleton/registry.test.ts`)**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readInfo, writeInfoAtomic, removeInfo, acquireSpawnLock, releaseSpawnLock, isPidAlive, lockPath } from "./registry.js";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "nlm-registry-"));
}
const info = { port: 4321, token: "t".repeat(64), pid: process.pid, version: "1.1.0", startedAt: new Date().toISOString() };

test("readInfo returns null when the file is absent", async () => {
  assert.equal(await readInfo(await tmpDir()), null);
});

test("write then read round-trips", async () => {
  const dir = await tmpDir();
  await writeInfoAtomic(dir, info);
  assert.deepEqual(await readInfo(dir), info);
});

test("readInfo returns null on corrupt json", async () => {
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, "singleton.json"), "{nope");
  assert.equal(await readInfo(dir), null);
});

test("readInfo returns null on wrong shape", async () => {
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, "singleton.json"), JSON.stringify({ port: "80" }));
  assert.equal(await readInfo(dir), null);
});

test("removeInfo tolerates a missing file", async () => {
  await removeInfo(await tmpDir()); // must not throw
});

test("lock: second acquire fails while holder is alive", async () => {
  const dir = await tmpDir();
  assert.equal(await acquireSpawnLock(dir), true);
  assert.equal(await acquireSpawnLock(dir), false); // holder = this live process
  await releaseSpawnLock(dir);
  assert.equal(await acquireSpawnLock(dir), true);
});

test("lock: stale lock from a dead pid is stolen", async () => {
  const dir = await tmpDir();
  await fs.writeFile(lockPath(dir), "999999999"); // no such pid
  assert.equal(await acquireSpawnLock(dir), true);
});

test("isPidAlive", () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(999999999), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/singleton/registry.test.ts`
Expected: FAIL — cannot find module `./registry.js`.

- [ ] **Step 3: Implement `src/singleton/registry.ts`**

```ts
/**
 * Singleton registry: singleton.json (backend endpoint + token) and
 * singleton.lock (spawn lock) in the data dir. All reads are validated;
 * corrupt files are treated as absent.
 */
import fsp from "node:fs/promises";
import path from "node:path";

export interface SingletonInfo {
  port: number;
  token: string;
  pid: number;
  version: string;
  startedAt: string;
}

export function infoPath(dataDir: string): string {
  return path.join(dataDir, "singleton.json");
}

export function lockPath(dataDir: string): string {
  return path.join(dataDir, "singleton.lock");
}

/** Signal 0 probes existence without touching the process. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readInfo(dataDir: string): Promise<SingletonInfo | null> {
  try {
    const data = JSON.parse(await fsp.readFile(infoPath(dataDir), "utf-8"));
    if (
      typeof data?.port !== "number" ||
      typeof data?.token !== "string" ||
      typeof data?.pid !== "number" ||
      typeof data?.version !== "string" ||
      typeof data?.startedAt !== "string"
    ) {
      return null;
    }
    return data as SingletonInfo;
  } catch {
    return null;
  }
}

/** Temp file + rename: readers never observe a half-written file. */
export async function writeInfoAtomic(dataDir: string, info: SingletonInfo): Promise<void> {
  const target = infoPath(dataDir);
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(info, null, 2), "utf-8");
  await fsp.rename(tmp, target);
}

export async function removeInfo(dataDir: string): Promise<void> {
  try {
    await fsp.unlink(infoPath(dataDir));
  } catch {
    // absent is fine
  }
}

/** True when this process now holds the lock. A lock whose holder is dead is stolen. */
export async function acquireSpawnLock(dataDir: string): Promise<boolean> {
  const p = lockPath(dataDir);
  try {
    await fsp.writeFile(p, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      const holder = Number.parseInt(await fsp.readFile(p, "utf-8"), 10);
      if (!Number.isNaN(holder) && isPidAlive(holder)) return false;
      await fsp.unlink(p);
      await fsp.writeFile(p, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
}

export async function releaseSpawnLock(dataDir: string): Promise<void> {
  try {
    await fsp.unlink(lockPath(dataDir));
  } catch {
    // absent is fine
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/singleton/registry.test.ts`
Expected: all pass.

- [ ] **Step 5: Add the npm script and commit**

Add `"test:unit": "tsx --test src/singleton/*.test.ts"` to `package.json` scripts.

```bash
git add src/singleton/registry.ts src/singleton/registry.test.ts package.json
git commit -m "Add the singleton registry with lock stealing and atomic writes"
```

---

### Task 4: Backend role

**Files:**
- Create: `src/singleton/backend.ts`
- Modify: `src/index.ts` (dispatch `--backend` before the singleton/direct decision)

**Interfaces:**
- Consumes: `createServerCore`, `createMcpServer` (Task 2); `writeInfoAtomic`, `removeInfo` (Task 3); `CONFIG.backendGraceMs`, `CONFIG.logsDir`, `SERVER_VERSION` (Task 1).
- Produces: `async function runBackend(): Promise<void>`; HTTP endpoints on `127.0.0.1:<ephemeral>`: `POST|GET|DELETE /mcp` (MCP), `GET /health` → `{ ok: true, version, pid }`, `POST /shutdown` → `202` then exit. All require `Authorization: Bearer <token>`.

- [ ] **Step 1: Implement `src/singleton/backend.ts`**

```ts
/**
 * Backend role: the full server behind localhost Streamable HTTP.
 * One per machine; lifecycle is bound to its connected proxies.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CONFIG, SERVER_VERSION } from "../config.js";
import { createServerCore, createMcpServer, type ServerCore } from "../server-core.js";
import { log, setGlobalLogger, createLogger } from "../utils/logger.js";
import { writeInfoAtomic, removeInfo } from "./registry.js";

const CLIENT_TTL_MS = 90_000;   // session dead after this long without a request
const SWEEP_INTERVAL_MS = 15_000;
const STARTUP_GRACE_MS = 120_000;

interface ClientSession {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

function redirectLogsToFile(): void {
  const logPath = path.join(CONFIG.logsDir, "backend.log");
  const stream = fs.createWriteStream(logPath, { flags: "w" }); // truncate per run
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  setGlobalLogger(createLogger(true, (msg) => stream.write(stripAnsi(msg) + "\n")));
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${token}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function runBackend(): Promise<void> {
  redirectLogsToFile();
  const token = randomBytes(32).toString("hex");
  const core: ServerCore = createServerCore();
  const sessions = new Map<string, ClientSession>();
  let graceTimer: NodeJS.Timeout | null = null;
  let everHadClient = false;
  let shuttingDown = false;

  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.warning(`🛑 Backend shutting down (${reason})`);
    try {
      await core.toolHandlers.cleanup(); // closes notebook sessions and Chrome
    } catch (error) {
      log.warning(`⚠️  Cleanup failed during shutdown: ${error}`);
    }
    await removeInfo(CONFIG.dataDir);
    httpServer.close();
    process.exit(0);
  };

  const scheduleExitIfEmpty = (): void => {
    if (sessions.size > 0 || graceTimer) return;
    graceTimer = setTimeout(() => void shutdown("no client for the grace period"), CONFIG.backendGraceMs);
  };

  const httpServer = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      log.error(`❌ HTTP handler error: ${error}`);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!isAuthorized(req, token)) {
      res.writeHead(401).end();
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: SERVER_VERSION, pid: process.pid }));
      return;
    }
    if (pathname === "/shutdown" && req.method === "POST") {
      res.writeHead(202).end();
      void shutdown("shutdown requested (version skew or explicit)");
      return;
    }
    if (pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId !== undefined) {
      const session = sessions.get(sessionId);
      if (!session) {
        res.writeHead(404).end();
        return;
      }
      session.lastSeen = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(400).end(); // GET/DELETE make no sense without a session
      return;
    }

    // No session header: a new client initializing.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    transport.onclose = () => {
      if (transport.sessionId && sessions.delete(transport.sessionId)) {
        log.info(`👋 MCP client disconnected (${sessions.size} left)`);
        scheduleExitIfEmpty();
      }
    };
    const server = createMcpServer(core);
    await server.connect(transport);
    await transport.handleRequest(req, res);
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, lastSeen: Date.now() });
      everHadClient = true;
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      log.success(`🤝 MCP client connected (${sessions.size} active)`);
    }
  }

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  await writeInfoAtomic(CONFIG.dataDir, {
    port,
    token,
    pid: process.pid,
    version: SERVER_VERSION,
    startedAt: new Date().toISOString(),
  });
  log.success(`✅ Backend listening on 127.0.0.1:${port} (pid ${process.pid})`);

  // Startup guard: the proxy that spawned us may have died.
  setTimeout(() => {
    if (!everHadClient) void shutdown("no client ever connected");
  }, STARTUP_GRACE_MS).unref();

  // Liveness sweeper: HTTP sessions outlive TCP, so silence means death.
  setInterval(() => {
    const now = Date.now();
    for (const [, session] of sessions) {
      if (now - session.lastSeen > CLIENT_TTL_MS) void session.transport.close();
    }
  }, SWEEP_INTERVAL_MS).unref();

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
```

- [ ] **Step 2: Wire the role into `src/index.ts`**

In `main()`, after the `config` CLI branch, before the banner:

```ts
  if (args.includes("--backend")) {
    const { runBackend } = await import("./singleton/backend.js");
    await runBackend();
    return; // keeps running; exits via its own lifecycle
  }
```

(No banner in backend mode: its output goes to the log file.)

- [ ] **Step 3: Build and verify by hand**

```bash
npm run build
NOTEBOOK_BACKEND_GRACE_MS=5000 node dist/index.js --backend &
sleep 2
node -e "
const fs=require('fs'),os=require('os'),path=require('path');
const p=path.join(process.env.APPDATA ?? path.join(os.homedir(),'.local','share'),'notebooklm-mcp','singleton.json');
const info=JSON.parse(fs.readFileSync(p,'utf-8'));
fetch(\`http://127.0.0.1:\${info.port}/health\`,{headers:{Authorization:'Bearer '+info.token}})
  .then(r=>r.json()).then(j=>{console.log('health:',j); if(!j.ok)process.exit(1);});
fetch(\`http://127.0.0.1:\${info.port}/health\`).then(r=>{console.log('no-token status:',r.status); if(r.status!==401)process.exit(1);});
"
```

Expected: `health: { ok: true, version: '1.1.0', ... }`, `no-token status: 401`. Then wait ~2 minutes (startup guard): the process exits by itself and `singleton.json` is gone. Check `backend.log` under the data dir's `logs/` for the shutdown line.

- [ ] **Step 4: Commit**

```bash
git add src/singleton/backend.ts src/index.ts
git commit -m "Add the backend role behind authenticated localhost HTTP"
```

---

### Task 5: Discovery and spawn

**Files:**
- Create: `src/singleton/spawn.ts`

**Interfaces:**
- Consumes: registry API (Task 3), `/health` + `/shutdown` contract (Task 4), `CONFIG.dataDir`, `SERVER_VERSION`.
- Produces: `async function ensureBackend(): Promise<{ url: string; token: string }>` — `url` like `http://127.0.0.1:4321` (no path). Throws `Error` with an actionable message (naming `backend.log`) when no backend can be reached or spawned.

- [ ] **Step 1: Implement `src/singleton/spawn.ts`**

```ts
/**
 * Backend discovery and spawn. Exactly one backend per machine:
 * the spawn lock decides who launches it; everyone else waits for
 * singleton.json to become connectable.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { CONFIG, SERVER_VERSION } from "../config.js";
import { log } from "../utils/logger.js";
import {
  type SingletonInfo,
  readInfo,
  removeInfo,
  isPidAlive,
  acquireSpawnLock,
  releaseSpawnLock,
} from "./registry.js";

const WAIT_READY_MS = 30_000;
const WAIT_GONE_MS = 10_000;
const POLL_MS = 250;
const PING_TIMEOUT_MS = 2_000;

export interface BackendHandle {
  url: string;
  token: string;
}

function toHandle(info: SingletonInfo): BackendHandle {
  return { url: `http://127.0.0.1:${info.port}`, token: info.token };
}

async function ping(info: SingletonInfo): Promise<{ ok: boolean; version: string } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/health`, {
      headers: { Authorization: `Bearer ${info.token}` },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as { ok: boolean; version: string };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A responding, version-matching backend — or null. Handles skew and stale files. */
async function connectable(): Promise<SingletonInfo | null> {
  const info = await readInfo(CONFIG.dataDir);
  if (!info) return null;
  const health = await ping(info);
  if (!health?.ok) {
    if (!isPidAlive(info.pid)) await removeInfo(CONFIG.dataDir); // stale file of a dead backend
    return null;
  }
  if (health.version !== SERVER_VERSION) {
    log.warning(`🔁 Backend version ${health.version} ≠ ${SERVER_VERSION}; asking it to exit...`);
    try {
      await fetch(`http://127.0.0.1:${info.port}/shutdown`, {
        method: "POST",
        headers: { Authorization: `Bearer ${info.token}` },
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
    } catch {
      // it may exit before answering; the pid poll below decides
    }
    const deadline = Date.now() + WAIT_GONE_MS;
    while (Date.now() < deadline && isPidAlive(info.pid)) await sleep(POLL_MS);
    if (isPidAlive(info.pid)) {
      throw new Error(
        `A backend of version ${health.version} (pid ${info.pid}) refuses to exit; ` +
        `close it manually before using version ${SERVER_VERSION}.`
      );
    }
    await removeInfo(CONFIG.dataDir);
    return null;
  }
  return info;
}

function spawnBackend(): void {
  const script = process.argv[1];
  log.info(`🚀 Spawning backend: ${process.execPath} ${script} --backend`);
  const child = spawn(process.execPath, [script, "--backend"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
}

async function waitForBackend(timeoutMs: number): Promise<SingletonInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await connectable();
    if (info) return info;
    await sleep(POLL_MS);
  }
  const logPath = path.join(CONFIG.logsDir, "backend.log");
  throw new Error(`Backend did not become ready within ${timeoutMs / 1000}s. See ${logPath}`);
}

export async function ensureBackend(): Promise<BackendHandle> {
  const existing = await connectable();
  if (existing) return toHandle(existing);

  if (await acquireSpawnLock(CONFIG.dataDir)) {
    try {
      // Re-check under the lock: another proxy may have finished spawning meanwhile.
      const raced = await connectable();
      if (raced) return toHandle(raced);
      spawnBackend();
      return toHandle(await waitForBackend(WAIT_READY_MS));
    } finally {
      await releaseSpawnLock(CONFIG.dataDir);
    }
  }
  // Someone else holds the spawn lock: wait for their backend.
  return toHandle(await waitForBackend(WAIT_READY_MS));
}
```

Note: `spawnBackend` uses `process.argv[1]`, which is `dist/index.js` in production. Under `tsx src/index.ts` the spawned `node <file.ts>` cannot run — development uses `NOTEBOOK_SINGLETON=false` or a manually started backend; Task 10 documents this.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean. (Behavioral verification comes with the proxy in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/singleton/spawn.ts
git commit -m "Add backend discovery with spawn lock and version-skew handover"
```

---

### Task 6: Proxy role, default mode

**Files:**
- Create: `src/singleton/proxy.ts`
- Modify: `src/index.ts` (default role becomes proxy; `NOTEBOOK_SINGLETON=false` keeps direct)

**Interfaces:**
- Consumes: `ensureBackend()` (Task 5); backend `/mcp` endpoint (Task 4).
- Produces: `async function runProxy(): Promise<void>`. Internal message ids `"__nlm_replay__"` and `"__nlm_ping_<n>"` never reach the client. (Task 8 extends this file with reconnect/replay; the hooks — recorded handshake, `pendingIds`, `onBackendLost` — are laid down here.)

- [ ] **Step 1: Implement `src/singleton/proxy.ts`**

```ts
/**
 * Proxy role: a pure JSON-RPC pipe between the stdio client (Claude
 * Desktop) and the shared backend over Streamable HTTP. No Server or
 * Client SDK objects in the path — everything, tools and progress
 * notifications included, passes through untouched.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../utils/logger.js";
import { ensureBackend } from "./spawn.js";

const HEARTBEAT_MS = 30_000;
export const REPLAY_ID = "__nlm_replay__";
const PING_PREFIX = "__nlm_ping_";

type AnyMessage = JSONRPCMessage & { id?: string | number | null; method?: string };

function isInternalId(id: string | number): boolean {
  return id === REPLAY_ID || String(id).startsWith(PING_PREFIX);
}

export async function runProxy(): Promise<void> {
  const stdio = new StdioServerTransport();
  let backend: StreamableHTTPClientTransport | null = null;
  const queue: AnyMessage[] = [];
  const pendingIds = new Set<string | number>();
  let initializeRequest: AnyMessage | null = null;
  let initializedNotification: AnyMessage | null = null;
  let pingCounter = 0;
  let closingDown = false;

  const toClient = (m: AnyMessage): void => {
    void stdio.send(m as JSONRPCMessage).catch((e) => log.error(`❌ stdio send failed: ${e}`));
  };

  const fromBackend = (m: AnyMessage): void => {
    if (m.id !== undefined && m.id !== null && isInternalId(m.id)) return; // replay/ping answers stop here
    if (m.id !== undefined && m.id !== null && m.method === undefined) pendingIds.delete(m.id);
    toClient(m);
  };

  // Task 8 turns this into reconnect-with-replay; for now losing the backend is fatal.
  const onBackendLost = (why: string): void => {
    if (closingDown) return;
    log.error(`❌ Backend connection lost (${why}); exiting so the client restarts us`);
    process.exit(1);
  };

  const connect = async (): Promise<void> => {
    const { url, token } = await ensureBackend();
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    transport.onmessage = (m) => fromBackend(m as AnyMessage);
    transport.onerror = (e) => log.warning(`⚠️  Backend transport error: ${e}`);
    transport.onclose = () => {
      if (backend === transport) {
        backend = null;
        onBackendLost("transport closed");
      }
    };
    await transport.start();
    backend = transport;
    while (queue.length > 0 && backend === transport) {
      const m = queue.shift()!;
      await transport.send(m as JSONRPCMessage);
    }
  };

  stdio.onmessage = (m) => {
    const msg = m as AnyMessage;
    if (msg.method === "initialize") initializeRequest = msg;
    if (msg.method === "notifications/initialized") initializedNotification = msg;
    void initializedNotification; // recorded for Task 8's replay
    if (msg.id !== undefined && msg.id !== null && msg.method !== undefined) pendingIds.add(msg.id);
    const t = backend;
    if (t) {
      t.send(msg as JSONRPCMessage).catch((e) => log.warning(`⚠️  Forward failed: ${e}`));
    } else {
      queue.push(msg);
    }
  };
  stdio.onclose = () => {
    closingDown = true;
    void (async () => {
      try {
        await backend?.terminateSession();
        await backend?.close();
      } catch {
        // best effort: the backend TTL sweeper covers us
      }
      process.exit(0);
    })();
  };

  await stdio.start();
  try {
    await connect();
  } catch (error) {
    log.error(`❌ Cannot reach or start the shared backend: ${error}`);
    process.exit(1);
  }
  log.success("✅ Proxy connected to the shared backend");
  void initializeRequest; // recorded for Task 8's replay

  setInterval(() => {
    backend
      ?.send({ jsonrpc: "2.0", id: `${PING_PREFIX}${pingCounter++}`, method: "ping" })
      .catch(() => onBackendLost("heartbeat failed"));
  }, HEARTBEAT_MS).unref();
}
```

Implementation note: `StreamableHTTPClientTransport.terminateSession()` exists in SDK 1.30 (sends the HTTP DELETE); if the exact name differs at compile time, check `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts` and use the method that issues DELETE. The `void x;` statements keep `noUnusedLocals` quiet until Task 8 uses them.

- [ ] **Step 2: Make proxy the default in `src/index.ts`**

Replace the tail of `main()`:

```ts
  printBanner();
  if (!CONFIG.singletonEnabled) {
    await runDirect();
    return;
  }
  const { runProxy } = await import("./singleton/proxy.js");
  await runProxy();
```

- [ ] **Step 3: Build and smoke both modes**

```bash
npm run build
SMOKE_ENV='{"NOTEBOOK_SINGLETON":"false"}' node scripts/smoke-client.mjs   # direct still works
node scripts/smoke-client.mjs                                              # proxy → spawned backend
```

Expected: both print `OK: <n> tools ...`. After the second, `singleton.json` exists; within ~90 s + grace of the client closing, the backend exits on its own (TTL + grace — the clean DELETE path makes it faster).

- [ ] **Step 4: Commit**

```bash
git add src/singleton/proxy.ts src/index.ts
git commit -m "Make the stdio entry a transparent proxy to the shared backend"
```

---

### Task 7: Integration test script

**Files:**
- Create: `scripts/test-singleton.mjs`
- Modify: `package.json` (add `"test:singleton": "node scripts/test-singleton.mjs"`)

**Interfaces:**
- Consumes: built `dist/index.js` in every role; `singleton.json` shape (Task 3).

- [ ] **Step 1: Write `scripts/test-singleton.mjs`**

```js
// Integration test: two concurrent proxies share one backend; the backend
// exits after the grace period once both clients are gone.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GRACE_MS = 3000;
const dataDir = process.platform === "win32"
  ? path.join(process.env.APPDATA, "notebooklm-mcp")
  : process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "notebooklm-mcp")
    : path.join(os.homedir(), ".local", "share", "notebooklm-mcp");
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
await a.close();
await b.close();
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
```

- [ ] **Step 2: Run it**

Run: `npm run build && node scripts/test-singleton.mjs`
Expected: four `ok:` lines then `PASS: singleton integration`. If step 4 hangs, check that `terminateSession()` really issues the DELETE (see Task 6 note) — the TTL sweeper alone would need ~90 s + grace, which this test deliberately does not wait for.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-singleton.mjs package.json
git commit -m "Add the two-surface singleton integration test"
```

---

### Task 8: Reconnect with handshake replay

**Files:**
- Modify: `src/singleton/proxy.ts`
- Modify: `scripts/test-singleton.mjs` (add the crash-recovery scenario)

**Interfaces:**
- Consumes: everything Task 6 laid down (`initializeRequest`, `initializedNotification`, `pendingIds`, `onBackendLost`, `REPLAY_ID`).
- Produces: on backend loss the proxy synthesizes error responses for in-flight ids, respawns/reconnects, replays the recorded handshake, then resumes piping. After 3 consecutive failed reconnect attempts it exits 1.

- [ ] **Step 1: Rework the loss path in `src/singleton/proxy.ts`**

Replace `onBackendLost` and extend `connect` (diff-level description; resulting logic shown in full):

```ts
const RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1_000;
const REPLAY_TIMEOUT_MS = 10_000;

let reconnecting = false;
let replayResolve: (() => void) | null = null;

// In fromBackend, BEFORE the isInternalId return, add:
//   if (m.id === REPLAY_ID) { replayResolve?.(); replayResolve = null; }

const failPending = (): void => {
  for (const id of pendingIds) {
    toClient({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: "NotebookLM backend restarted — please retry the request" },
    } as AnyMessage);
  }
  pendingIds.clear();
};

const onBackendLost = (why: string): void => {
  if (closingDown || reconnecting) return;
  reconnecting = true;
  log.warning(`⚠️  Backend connection lost (${why}); reconnecting...`);
  failPending();
  void (async () => {
    for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
      try {
        await connect(true);
        log.success(`✅ Reconnected to the backend (attempt ${attempt})`);
        reconnecting = false;
        return;
      } catch (error) {
        log.warning(`⚠️  Reconnect attempt ${attempt} failed: ${error}`);
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS * attempt));
      }
    }
    log.error("❌ Backend unreachable after retries; exiting");
    process.exit(1);
  })();
};

// connect(replay: boolean): after transport.start(), before flushing the queue:
if (replay && initializeRequest) {
  const done = new Promise<void>((resolve, reject) => {
    replayResolve = resolve;
    setTimeout(() => reject(new Error("handshake replay timed out")), REPLAY_TIMEOUT_MS).unref();
  });
  await transport.send({ ...initializeRequest, id: REPLAY_ID } as JSONRPCMessage);
  await done; // fromBackend swallows the response and resolves this
  if (initializedNotification) await transport.send(initializedNotification as JSONRPCMessage);
}
```

The initial call becomes `connect(false)`. Remove the two `void initializeRequest/initializedNotification;` placeholder statements. Forward failures in `stdio.onmessage` now queue the message and call `onBackendLost("send failed")` instead of only logging.

- [ ] **Step 2: Extend `scripts/test-singleton.mjs`**

Insert between scenarios 3 and 4 (backend pid is in `info.pid`; re-read `singleton.json` afterward for the new pid used by scenario 4):

```js
// 3b. Kill the backend; both surfaces must recover transparently.
process.kill(info.pid);
await sleep(1000);
const [ra, rb] = await Promise.all([a.listTools(), b.listTools()]);
if (!ra.tools.length || !rb.tools.length) fail("a surface did not recover after backend death");
const reborn = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
if (reborn.pid === info.pid) fail("backend pid unchanged after kill?");
ok(`both surfaces recovered on new backend pid ${reborn.pid}`);
```

And make scenario 4 use `reborn.pid` instead of `info.pid`.

- [ ] **Step 3: Run the integration test**

Run: `npm run build && node scripts/test-singleton.mjs`
Expected: `PASS` including the recovery line. Note: `listTools` may race the reconnect and get a synthesized `-32603` error — the SDK client surfaces it as a rejected promise; wrap the two `listTools` calls in one retry (`try { ... } catch { await sleep(2000); retry once }`) inside the script, mirroring what a real client (Claude) would do when told to retry.

- [ ] **Step 4: Commit**

```bash
git add src/singleton/proxy.ts scripts/test-singleton.mjs
git commit -m "Survive backend loss by replaying the handshake on a fresh session"
```

---

### Task 9: Version-skew decision, extracted and unit-tested

The replacement decision compares the `/health` payload's `version` with the proxy's own `SERVER_VERSION`, so an end-to-end test would need two different builds running at once. Instead the decision is extracted into a pure function and unit-tested; `ensureBackend`'s plumbing around it is already exercised by the integration script.

**Files:**
- Modify: `src/singleton/spawn.ts`
- Test: `src/singleton/spawn.test.ts`

**Interfaces:**
- Produces: `function decideOnHealth(health: { ok: boolean; version: string } | null, ownVersion: string): "connect" | "replace" | "unreachable"` — exported from `spawn.ts`.

- [ ] **Step 1: Write the failing test (`src/singleton/spawn.test.ts`)**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOnHealth } from "./spawn.js";

test("matching version connects", () => {
  assert.equal(decideOnHealth({ ok: true, version: "1.1.0" }, "1.1.0"), "connect");
});

test("different version is replaced", () => {
  assert.equal(decideOnHealth({ ok: true, version: "1.0.0" }, "1.1.0"), "replace");
});

test("no health response is unreachable", () => {
  assert.equal(decideOnHealth(null, "1.1.0"), "unreachable");
  assert.equal(decideOnHealth({ ok: false, version: "1.1.0" }, "1.1.0"), "unreachable");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/singleton/spawn.test.ts`
Expected: FAIL — `decideOnHealth` is not exported.

- [ ] **Step 3: Extract the function in `src/singleton/spawn.ts`**

```ts
/** Pure decision so it can be unit-tested: what to do with a pinged backend. */
export function decideOnHealth(
  health: { ok: boolean; version: string } | null,
  ownVersion: string
): "connect" | "replace" | "unreachable" {
  if (!health?.ok) return "unreachable";
  return health.version === ownVersion ? "connect" : "replace";
}
```

Rewrite `connectable()` to branch on `decideOnHealth(health, SERVER_VERSION)`: `"unreachable"` → the existing stale-file cleanup and `return null`; `"replace"` → the existing shutdown/wait/remove flow and `return null`; `"connect"` → `return info`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit` (the glob picks up both test files)
Expected: all pass. Then `npm run build && node scripts/test-singleton.mjs` still passes.

- [ ] **Step 5: Commit**

```bash
git add src/singleton/spawn.ts src/singleton/spawn.test.ts
git commit -m "Extract and test the version-skew decision"
```

---

### Task 10: Documentation and stale-comment fix

**Files:**
- Modify: `README.md` (architecture section: proxy/backend/direct, new env vars, new runtime files, dev note about `NOTEBOOK_SINGLETON=false` under `tsx`)
- Modify: `docs/configuration.md` (env var table: `NOTEBOOK_SINGLETON`, `NOTEBOOK_BACKEND_GRACE_MS`)
- Modify: `docs/troubleshooting.md` (where `backend.log` lives; "two surfaces" section rewritten: the contention is gone, what to do if the backend hangs — delete `singleton.json`, restart)
- Modify: `CLAUDE.md` (structure tree: `server-core.ts`, `singleton/`)
- Modify: `src/session/shared-context-manager.ts:204-217` (comment only)

- [ ] **Step 1: Fix the stale comment**

In `shared-context-manager.ts`, the catch-block comment claims the isolated-profile retry "is still authenticated, because the cookies travel through storageState". Measured on 2026-08-20 (commit `29ddeab`) this is false: a fresh profile is asked for a full interactive login. Replace those two sentences with:

```ts
      // With strategy "auto" any launch failure earns one retry on an
      // isolated profile. Note the retry usually CANNOT authenticate:
      // Google treats a fresh profile as a new device and demands a full
      // interactive login (measured 2026-08-20). It remains only for
      // Chrome failing to start for reasons other than profile contention
      // — and since the singleton backend, contention should no longer
      // occur at all.
```

- [ ] **Step 2: Update the docs listed above**

Content to convey (write it out, no placeholders): the three roles and who uses them; `singleton.json` / `singleton.lock` / `logs/backend.log` under the data dir; both env vars with defaults; Claude Desktop config unchanged; concurrent Chat + Cowork now supported; dev workflow (`npm run dev` implies `NOTEBOOK_SINGLETON=false` or a hand-started `--backend`).

- [ ] **Step 3: Run everything once more**

```bash
npm run build && npm run test:unit && node scripts/smoke-client.mjs && node scripts/test-singleton.mjs
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/configuration.md docs/troubleshooting.md CLAUDE.md src/session/shared-context-manager.ts
git commit -m "Document the singleton backend and retire a disproven comment"
```

---

### Task 11: Manual acceptance in Claude Desktop

- [ ] **Step 1:** Restart Claude Desktop (it relaunches the MCP servers, now proxies).
- [ ] **Step 2:** From **Cowork**, ask a question against a notebook. Expected: normal answer; one backend process; `logs/backend.log` shows one client per surface as they connect.
- [ ] **Step 3:** While that session is still warm, from **Chat** ask a question against a notebook. Expected: normal answer — no "profile unavailable", no wait. This is the original failing scenario.
- [ ] **Step 4:** Quit Claude Desktop. Expected: within ~2 minutes (TTL + grace) no `node dist/index.js --backend` and no automation Chrome remain (check Task Manager); `singleton.json` is gone.
- [ ] **Step 5:** Commit nothing — record the outcome in the conversation; if any step fails, return to the relevant task.
