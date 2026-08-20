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

/** Pure decision so it can be unit-tested: what to do with a pinged backend. */
export function decideOnHealth(
  health: { ok: boolean; version: string } | null,
  ownVersion: string
): "connect" | "replace" | "unreachable" {
  if (!health?.ok) return "unreachable";
  return health.version === ownVersion ? "connect" : "replace";
}

/** A responding, version-matching backend — or null. Handles skew and stale files. */
async function connectable(): Promise<SingletonInfo | null> {
  const info = await readInfo(CONFIG.dataDir);
  if (!info) return null;
  const health = await ping(info);
  const decision = decideOnHealth(health, SERVER_VERSION);

  if (decision === "unreachable") {
    if (!isPidAlive(info.pid)) await removeInfo(CONFIG.dataDir); // stale file of a dead backend
    return null;
  }

  if (decision === "replace") {
    log.warning(`🔁 Backend version ${health!.version} ≠ ${SERVER_VERSION}; asking it to exit...`);
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
        `A backend of version ${health!.version} (pid ${info.pid}) refuses to exit; ` +
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
  // Without this, an async spawn failure (e.g. bad executable path) would
  // throw uncaught and crash the proxy. Logging is enough: waitForBackend's
  // timeout already produces the actionable error naming backend.log.
  child.on("error", (error) => log.error(`❌ Failed to spawn backend: ${error}`));
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
