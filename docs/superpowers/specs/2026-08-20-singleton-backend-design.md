# Singleton Backend Design

**Date**: 2026-08-20
**Status**: Approved
**Problem**: Claude Desktop starts one MCP server process per surface (Chat, Cowork). Both processes contend for the same persistent Chrome profile, which only one Chrome instance can hold. The isolated-profile fallback cannot authenticate (a fresh profile is treated by Google as a new device and requires full interactive login), so whichever surface starts second cannot query notebooks until the first releases the profile — up to ~20 minutes with default timeouts.

**Goal**: Both surfaces work concurrently. One browser, one Chrome profile, sessions as tabs — which is what the internal architecture already supports within a single process. The missing piece is sharing that single process across the stdio server instances Claude Desktop spawns.

## Architecture Overview

The same executable (`dist/index.js`) takes one of three roles:

| Role | Trigger | Behavior |
|------|---------|----------|
| **Proxy** | Default (what Claude Desktop launches) | stdio server toward the client; transparent JSON-RPC pipe toward the backend over Streamable HTTP |
| **Backend** | Internal flag `--backend` (never written by users) | The full existing `NotebookLMMCPServer` (browser, sessions, tools) listening on Streamable HTTP, bound to `127.0.0.1`, ephemeral port. Exactly one per machine. |
| **Direct** | `NOTEBOOK_SINGLETON=false` | Current behavior: full server on stdio, no proxy. Escape hatch for development, debugging, and any environment where the singleton is unwanted. |

The existing `config` CLI subcommand is unaffected and keeps precedence over role dispatch.

Claude Desktop configuration does not change: the same command now starts a proxy instead of a full server, and the proxy handles everything else.

### Core refactoring

`src/index.ts` currently builds the managers and the MCP `Server` inside one class. This is split into:

- A **core**: `AuthManager`, `SessionManager`, `NotebookLibrary`, `ToolHandlers`, `SettingsManager`, filtered tool definitions — instantiated **once per process**.
- A **factory** `createMcpServer(core)` returning a connected-ready MCP `Server` wired to that core.

Direct mode calls the factory once with a `StdioServerTransport`. Backend mode calls it once per connected MCP client (the standard SDK pattern for stateful Streamable HTTP: one `Server` + one transport per MCP session, shared application state behind them). Tool logic, definitions, and handlers are not touched.

## Discovery and Backend Spawn

Two files in the data dir (`%APPDATA%\notebooklm-mcp\` on Windows; `env-paths` equivalents elsewhere):

- **`singleton.json`** — written by the backend once it is listening, via atomic write (temp file + rename): `{ port, token, pid, version, startedAt }`.
- **`singleton.lock`** — spawn lock, created by a proxy with the `wx` open flag (fails if present), containing the proxy pid.

Proxy startup algorithm:

1. Read `singleton.json`. If present, perform an authenticated HTTP health ping. If the backend responds and its `version` matches the proxy's own → connect. If it responds but the version differs, follow the version-skew flow below before continuing.
2. If unusable (file absent, unparsable, ping fails, or recorded pid dead — checked with `process.kill(pid, 0)`): try to acquire `singleton.lock`.
   - **Lock acquired** → spawn the backend (`spawn(process.execPath, [<own script path>, "--backend"], { detached: true, windowsHide: true })`, stdio ignored, then `unref()`), poll for a valid, responding `singleton.json` (timeout 30 s), then release the lock and connect.
   - **Lock not acquired** → another proxy is already spawning: poll for a valid `singleton.json` (same timeout) and connect. Never spawn.
3. A stale lock (holder pid dead) is removed and acquisition retried.

This makes the "Chat and Cowork start in the same instant" race produce exactly one backend.

**Version skew**: after an update, a running backend may be older than a freshly started proxy. The proxy compares `singleton.json.version` with its own version; on mismatch it POSTs the authenticated `/shutdown` endpoint, waits for the old backend to exit (poll pid, timeout, and if the backend does not exit in time report an error naming the stale pid rather than spawning a second backend), then spawns the new version.

## Proxy: Pure Message Piping + Handshake Replay

The proxy connects two transports with no SDK `Server`/`Client` in between:

```
Claude Desktop ⇄ StdioServerTransport ⇄ [pipe] ⇄ StreamableHTTPClientTransport ⇄ Backend
```

`onmessage` on each side calls `send` on the other. Everything passes through unchanged: tool calls, prompts, resources, completions, progress notifications, errors. The proxy has zero per-tool code; future tools work without touching it.

The only stateful logic: the proxy **records** the client's `initialize` request and `notifications/initialized` notification as they pass through. If the backend connection drops (crash, kill):

1. Re-run discovery (respawning the backend if needed).
2. Replay the recorded handshake with a synthetic request id; swallow the response.
3. Resume piping.

Claude Desktop never notices. Notebook sessions that lived in the dead backend are lost; the next `ask_question` creates fresh ones. Requests in flight when the backend died receive a JSON-RPC error response synthesized by the proxy.

If a message arrives from the client before the handshake replay completes, it is queued and forwarded afterward, preserving order.

## Backend Lifecycle

- The backend counts connected MCP clients (each session's transport close event decrements).
- When the count reaches zero, a **grace timer** starts (default 60 s, `NOTEBOOK_BACKEND_GRACE_MS`). A new client cancels it.
- On expiry: close notebook sessions, close Chrome, delete `singleton.json`, exit. Closing Claude Desktop therefore leaves no residual processes.
- **Startup guard**: if no client connects within 120 s of startup (the spawning proxy died), exit the same way.
- **Client liveness**: Streamable HTTP sessions are not bound to a TCP connection, so a killed proxy would never register as disconnected on its own. The proxy therefore sends a JSON-RPC `ping` request every 30 s (responses are swallowed proxy-side and never reach the client), and the backend closes any MCP session that has made no HTTP request for 90 s. A cleanly exiting proxy also terminates its session explicitly (HTTP DELETE) so shutdown is prompt rather than TTL-bound.
- Backend logs (currently colored stderr) go to `dataDir/logs/backend.log`, truncated at startup. The logger gains a file-stream target for backend mode; proxy and direct modes keep stderr.

Existing mechanics are unchanged: per-notebook sessions with the 15-minute inactivity timeout, `releaseContextIfIdle` closing Chrome when no notebook session is active (now purely a resource saving, no longer entangled with cross-surface contention).

## Security

- HTTP server bound exclusively to `127.0.0.1`.
- A random 32-byte token, generated by the backend at startup and stored in `singleton.json` (user-profile file permissions), is required as `Authorization: Bearer <token>` on every HTTP request, `/shutdown` included.
- No network exposure; no other local user can drive the backend without reading the user's own data dir.

## Error Handling

| Failure | Behavior |
|---------|----------|
| Backend fails to start (spawn error, crash before listening) | Proxy logs a clear cause on stderr and exits nonzero → Claude Desktop shows the server unavailable, log says why |
| `singleton.json` corrupt / unparsable | Treated as absent |
| Stale lock (holder dead) | Removed, acquisition retried |
| Orphan backend (files deleted manually) | New backend overwrites `singleton.json`; orphan exits via the no-client guard |
| Backend dies mid-conversation | Proxy reconnects per the handshake-replay flow; in-flight requests get synthesized JSON-RPC errors |
| Chrome fails to start inside the backend | Existing isolated-profile fallback remains, now covering only genuine launch failures — profile contention no longer exists inside the single process |

## Testing

1. **Unit** (`node:test`, built into Node, no new dependencies): discovery/lock/stale-detection logic against a temp directory; `singleton.json` atomic write and parse; version-skew decision logic.
2. **Integration** (`scripts/test-singleton.mjs`): launch two proxies simultaneously; assert exactly one backend spawned; run `initialize` + `tools/list` through both; disconnect both; assert backend exits after the grace period.
3. **Manual acceptance**: real Claude Desktop, concurrent queries from Cowork and Chat — the original failing scenario.

## Configuration Additions

| Variable | Default | Meaning |
|----------|---------|---------|
| `NOTEBOOK_SINGLETON` | `true` | `false` = direct mode (legacy stdio, no proxy/backend) |
| `NOTEBOOK_BACKEND_GRACE_MS` | `60000` | Idle grace before the backend exits after the last client disconnects |

New files at runtime: `dataDir/singleton.json`, `dataDir/singleton.lock`, `dataDir/logs/backend.log`.

## Out of Scope

- Exposing the backend beyond localhost.
- Sharing the backend across OS users.
- Keeping the backend alive after Claude Desktop closes (explicitly decided against).
- Any change to tool definitions, structuring guidelines, auth flows, or selectors.

## Documentation Impact

README and `docs/configuration.md`: architecture note (proxy/backend/direct), the two new environment variables, the new runtime files, and troubleshooting guidance (how to find `backend.log`, how to force direct mode).
