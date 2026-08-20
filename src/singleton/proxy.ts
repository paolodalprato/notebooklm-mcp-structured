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
  // The id of the request currently mid-`t.send()`, if any (undefined for
  // non-request messages, which failPending never tracks). Lets pump()
  // resolve the one interleaving failPending() can't see: send() delivered
  // the message (no throw) but the backend died before the response came
  // back, after failPending already decided — correctly, at the time — that
  // this id was still "unsent" because it was still sitting in `queue`.
  let inFlightId: string | number | undefined;

  const toClient = (m: AnyMessage): void => {
    void stdio.send(m as JSONRPCMessage).catch((e) => log.error(`❌ stdio send failed: ${e}`));
  };

  const fromBackend = (m: AnyMessage): void => {
    // Ping answers stop here; replay answers never reach this shared handler
    // at all — each connect() attempt intercepts its own REPLAY_ID reply on
    // its own transport before the transport is published as `backend` (see
    // connect() below), so a stale attempt's late answer can't land here.
    if (m.id !== undefined && m.id !== null && isInternalId(m.id)) return;
    if (m.id !== undefined && m.id !== null && m.method === undefined) pendingIds.delete(m.id);
    toClient(m);
  };

  // Synthesizes an error only for ids that are truly in flight (sent to the
  // dead backend, response lost) — NOT for ids still sitting unsent in
  // `queue`, which the pump will deliver exactly once after reconnect.
  // Erroring a still-queued id would double-execute it: -32603 now, a real
  // (possibly costly, e.g. NotebookLM-quota-consuming) response later.
  const failPending = (): void => {
    const queuedIds = new Set<string | number>();
    // Only requests (m.method !== undefined) can suppress error synthesis
    // here — a queued client RESPONSE happening to carry the same id as a
    // pending request must not be mistaken for that request still being in
    // flight to us.
    for (const m of queue) {
      if (m.id !== undefined && m.id !== null && m.method !== undefined) queuedIds.add(m.id);
    }
    for (const id of pendingIds) {
      if (queuedIds.has(id)) continue; // unsent; keep tracking it in pendingIds until it's actually answered
      toClient({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: "NotebookLM backend restarted — please retry the request" },
      } as AnyMessage);
      pendingIds.delete(id); // this id's lifecycle is over; no real response is expected or wanted for it
    }
  };

  // Turns a lost backend into a fresh one: fail what was in flight, then
  // retry connect(true) — which respawns/reconnects and replays the
  // recorded handshake — a few times with backoff before giving up.
  const onBackendLost = (why: string): void => {
    if (closingDown || reconnecting) return;
    reconnecting = true;
    // Null out first so nothing routes further sends to the dying transport,
    // then close it so it can't deliver a late duplicate response for a
    // request we're about to fail/replay on the next transport. Closing
    // triggers `dying`'s onclose, but that checks `backend === transport`
    // — backend is already null (never re-equals this now-superseded
    // transport instance), so it can't re-enter onBackendLost.
    const dying = backend;
    backend = null;
    if (dying) void dying.close().catch(() => {});
    log.warning(`⚠️  Backend connection lost (${why}); reconnecting...`);
    failPending();
    void (async () => {
      for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
        if (closingDown) return; // the client left while we were about to retry; stop quietly
        try {
          await connect(true);
          // connect() itself tears down and returns without publishing if
          // closingDown flipped true while it was working — don't celebrate
          // a "reconnect" that was actually discarded.
          if (closingDown) return;
          log.success(`✅ Reconnected to the backend (attempt ${attempt})`);
          reconnecting = false;
          return;
        } catch (error) {
          if (closingDown) return;
          log.warning(`⚠️  Reconnect attempt ${attempt} failed: ${error}`);
          await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS * attempt));
        }
      }
      if (closingDown) return;
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
          inFlightId = m.id !== undefined && m.id !== null && m.method !== undefined ? m.id : undefined;
          try {
            await t.send(m as JSONRPCMessage);
          } catch (e) {
            log.warning(`⚠️  Forward failed: ${e}`);
            // Only treat this as a fresh loss if `t` is still the active backend —
            // a late failure from an already-superseded transport must not restart
            // a reconnect that may already have finished.
            if (backend === t) onBackendLost("send failed");
            inFlightId = undefined;
            break;
          }
          queue.shift(); // delivered; drop it before any identity check so it's never resent
          // Identity guard: a concurrent reconnect (heartbeat failure, transport
          // close) may have swapped `backend` to a fresh transport instance while
          // the send above was in flight. Never keep sending on this now-stale `t`
          // — bail out and let the pumpRequested kick (or connect()'s own
          // `void pump()`) resume the rest of the queue on the current transport.
          if (backend !== t) {
            // The send above succeeded — the message was delivered — but the
            // backend died before its response could come back on `t`. At the
            // moment onBackendLost's failPending() ran, this id was still
            // sitting in `queue` (we hadn't shifted it yet), so failPending
            // correctly-at-the-time treated it as unsent and left it alone.
            // It is now neither queued (just shifted) nor going to be
            // answered (t is superseded/closing) — resolve it here or the
            // client hangs on it forever.
            if (inFlightId !== undefined && pendingIds.has(inFlightId)) {
              toClient({
                jsonrpc: "2.0",
                id: inFlightId,
                error: { code: -32603, message: "NotebookLM backend restarted — please retry the request" },
              } as AnyMessage);
              pendingIds.delete(inFlightId);
            }
            inFlightId = undefined;
            break;
          }
          inFlightId = undefined;
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
    // Transport-scoped handshake gate: until this attempt's own handshake
    // (if any) completes, its REPLAY_ID answer is swallowed by the local
    // closure below — never by the shared `fromBackend` — and everything
    // else arriving early is dropped rather than forwarded, since this
    // transport isn't published as `backend` yet. This makes each attempt's
    // wait fully local: a slow/dead prior attempt's late REPLAY_ID answer
    // has no shared state left to resolve, so it can never complete a LATER
    // attempt's handshake wait.
    let handshakeDone = false;
    let localReplayResolve: (() => void) | null = null;
    transport.onmessage = (m) => {
      const msg = m as AnyMessage;
      if (!handshakeDone) {
        if (msg.id === REPLAY_ID) {
          localReplayResolve?.();
          localReplayResolve = null;
        }
        return;
      }
      fromBackend(msg);
    };
    transport.onerror = (e) => log.warning(`⚠️  Backend transport error: ${e}`);
    transport.onclose = () => {
      if (backend === transport) onBackendLost("transport closed");
    };

    try {
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
            localReplayResolve = null;
            reject(new Error("handshake replay timed out"));
          }, REPLAY_TIMEOUT_MS);
          timer.unref();
          localReplayResolve = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        await transport.send({ ...initializeRequest, id: REPLAY_ID } as JSONRPCMessage);
        await done; // this attempt's own onmessage above swallows the response and resolves this
        if (initializedNotification) await transport.send(initializedNotification as JSONRPCMessage);
      }
    } catch (error) {
      // A failed attempt must not leak a live, wired transport: close it so
      // it can't keep sockets/heartbeats open behind the next attempt's
      // fresh transport, and so any further message on it is simply gone.
      await transport.close().catch(() => {});
      throw error;
    }

    if (closingDown) {
      // The client disconnected while this attempt was in flight; don't
      // publish a session nobody will use. Tear down what we just
      // (re)established instead of leaving it as an orphan for the backend's
      // TTL sweeper to eventually notice.
      await transport.terminateSession().catch(() => {});
      await transport.close().catch(() => {});
      return;
    }
    handshakeDone = true;
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
  // connect() tears down and returns quietly without publishing if the
  // client disconnected while this very first connect was in flight.
  if (!closingDown) log.success("✅ Proxy connected to the shared backend");

  setInterval(() => {
    const t = backend;
    if (!t) return;
    t.send({ jsonrpc: "2.0", id: `${PING_PREFIX}${pingCounter++}`, method: "ping" }).catch(() => {
      if (backend === t) onBackendLost("heartbeat failed");
    });
  }, HEARTBEAT_MS).unref();
}
