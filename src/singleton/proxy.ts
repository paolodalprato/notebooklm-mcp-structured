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
