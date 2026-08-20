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
const RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1_000;
const REPLAY_TIMEOUT_MS = 10_000;

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
  let pumping = false;
  let pumpRequested = false;
  let reconnecting = false;
  let replayResolve: (() => void) | null = null;

  const toClient = (m: AnyMessage): void => {
    void stdio.send(m as JSONRPCMessage).catch((e) => log.error(`❌ stdio send failed: ${e}`));
  };

  const fromBackend = (m: AnyMessage): void => {
    if (m.id !== undefined && m.id !== null && isInternalId(m.id)) {
      if (m.id === REPLAY_ID) {
        replayResolve?.();
        replayResolve = null;
      }
      return; // replay/ping answers stop here
    }
    if (m.id !== undefined && m.id !== null && m.method === undefined) pendingIds.delete(m.id);
    toClient(m);
  };

  // Synthesizes an error for every client request still in flight when the
  // backend was lost, so the client (Claude) sees a rejected call it can
  // retry instead of hanging forever waiting for a reply that will never come.
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

  // Turns a lost backend into a fresh one: fail what was in flight, then
  // retry connect(true) — which respawns/reconnects and replays the
  // recorded handshake — a few times with backoff before giving up.
  const onBackendLost = (why: string): void => {
    if (closingDown || reconnecting) return;
    reconnecting = true;
    backend = null; // stop routing further sends to the dying/dead transport while we reconnect
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

  // Single in-order dispatch path: every client message, queued or fresh,
  // is sent through here so a mid-drain arrival can never race ahead of
  // the backlog still waiting to go out (two concurrent transport.send()
  // calls are not guaranteed to land in issue order).
  //
  // Re-entrancy note: pump() can be asked to run again while it is already
  // running (pumpRequested), because a reconnect may finish — swapping
  // `backend` to a fresh transport — while this run is still awaiting a
  // send on the old one. Without the kick, that fresh transport's `void
  // pump()` call (fired from connect()) would see `pumping === true` and
  // no-op, leaving the rest of the queue stranded until the next unrelated
  // client message happened to arrive.
  const pump = async (): Promise<void> => {
    if (pumping) {
      pumpRequested = true;
      return;
    }
    pumping = true;
    try {
      do {
        pumpRequested = false;
        while (queue.length > 0) {
          const t = backend;
          if (!t) break; // nothing to send on right now; connect() calls pump() again once reconnected
          const m = queue[0];
          try {
            await t.send(m as JSONRPCMessage);
          } catch (e) {
            log.warning(`⚠️  Forward failed: ${e}`);
            // Only treat this as a fresh loss if `t` is still the active backend —
            // a late failure from an already-superseded transport must not restart
            // a reconnect that may already have finished.
            if (backend === t) onBackendLost("send failed");
            break;
          }
          queue.shift(); // delivered; drop it before any identity check so it's never resent
          // Identity guard: a concurrent reconnect (heartbeat failure, transport
          // close) may have swapped `backend` to a fresh transport instance while
          // the send above was in flight. Never keep sending on this now-stale `t`
          // — bail out and let the pumpRequested kick (or connect()'s own
          // `void pump()`) resume the rest of the queue on the current transport.
          if (backend !== t) break;
        }
      } while (pumpRequested);
    } finally {
      pumping = false;
    }
  };

  const connect = async (replay: boolean): Promise<void> => {
    const { url, token } = await ensureBackend();
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    transport.onmessage = (m) => fromBackend(m as AnyMessage);
    transport.onerror = (e) => log.warning(`⚠️  Backend transport error: ${e}`);
    transport.onclose = () => {
      if (backend === transport) onBackendLost("transport closed");
    };
    await transport.start();
    if (replay && initializeRequest) {
      // Replay the original handshake on the fresh session before anything
      // else flows, so the new backend sees the same initialize/initialized
      // sequence a brand-new client connection would send. `backend` is
      // deliberately not yet reassigned: any client message queued during
      // this window stays queued (pump() sees `backend` still null/old) so
      // nothing can jump ahead of the handshake on the new transport.
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          replayResolve = null;
          reject(new Error("handshake replay timed out"));
        }, REPLAY_TIMEOUT_MS);
        timer.unref();
        replayResolve = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      await transport.send({ ...initializeRequest, id: REPLAY_ID } as JSONRPCMessage);
      await done; // fromBackend swallows the response and resolves this
      if (initializedNotification) await transport.send(initializedNotification as JSONRPCMessage);
    }
    backend = transport;
    void pump();
  };

  stdio.onmessage = (m) => {
    const msg = m as AnyMessage;
    if (msg.method === "initialize") initializeRequest = msg;
    if (msg.method === "notifications/initialized") initializedNotification = msg;
    if (msg.id !== undefined && msg.id !== null && msg.method !== undefined) pendingIds.add(msg.id);
    queue.push(msg);
    void pump();
  };
  // Idempotent: stdio.onclose and the raw stdin listeners below can all fire
  // for the same disconnect (this SDK version's StdioServerTransport only
  // reacts to stdin 'data'/'error', not 'end'/'close' — so we hook stdin
  // directly too, which is what actually fires when the client ends our
  // stdin first, per the MCP stdio shutdown sequence).
  const shutdownFromClient = (): void => {
    if (closingDown) return;
    closingDown = true;
    void (async () => {
      try {
        await backend?.terminateSession();
        await backend?.close();
      } catch {
        // best effort: the backend TTL sweeper covers us
      } finally {
        // Do not force `process.exit(0)` here: on a very fast disconnect the
        // undici/fetch sockets behind StreamableHTTPClientTransport can still
        // be mid-teardown, and killing the process mid-close is what trips a
        // native libuv assertion on Windows (src/win/async.c). Nothing else
        // in this process keeps the event loop alive — the heartbeat interval
        // is unref()'d and stdin has already ended — so letting it drain
        // naturally exits cleanly once those handles finish closing on their
        // own. A short safety-net timer forces the exit if something
        // unexpected keeps the loop alive.
        setTimeout(() => process.exit(0), 3_000).unref();
      }
    })();
  };
  stdio.onclose = shutdownFromClient;

  await stdio.start();
  process.stdin.on("end", shutdownFromClient);
  process.stdin.on("close", shutdownFromClient);
  try {
    await connect(false);
  } catch (error) {
    log.error(`❌ Cannot reach or start the shared backend: ${error}`);
    process.exit(1);
  }
  log.success("✅ Proxy connected to the shared backend");

  setInterval(() => {
    const t = backend;
    if (!t) return;
    t.send({ jsonrpc: "2.0", id: `${PING_PREFIX}${pingCounter++}`, method: "ping" }).catch(() => {
      if (backend === t) onBackendLost("heartbeat failed");
    });
  }, HEARTBEAT_MS).unref();
}
