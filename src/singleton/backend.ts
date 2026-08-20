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
