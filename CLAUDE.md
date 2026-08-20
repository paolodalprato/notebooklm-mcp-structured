# NotebookLM MCP Structured

Enhanced MCP server for NotebookLM with client-side prompt structuring for source fidelity in professional document analysis.

## Stack

- **Language**: TypeScript (ES2022, Node16 modules)
- **Runtime**: Node.js >= 18.0.0
- **Framework**: MCP SDK (@modelcontextprotocol/sdk)
- **Browser automation**: Patchright (Playwright fork with stealth features)
- **Validation**: Zod
- **Testing**: `node:test` unit tests for the singleton module (`npm run test:unit`) plus an integration script (`npm run test:singleton`); the rest of the server is manually tested via `tsx src/index.ts`

## Structure

```
src/
├── index.ts                    # Entry point: role dispatch (proxy/backend/direct) + CLI commands
├── server-core.ts              # Shared server core: managers + MCP Server factory, reused by all three roles
├── config.ts                   # Configuration: defaults, ENV overrides, paths, timing constants
├── errors.ts                   # Custom errors + page closed detection helper
├── selectors.ts                # Centralized DOM selectors for NotebookLM UI
├── types.ts                    # Global TypeScript interfaces
├── singleton/
│   ├── proxy.ts                 # Proxy role: stdio<->HTTP JSON-RPC pipe, handshake replay on reconnect
│   ├── backend.ts               # Backend role: shared server over localhost Streamable HTTP
│   ├── spawn.ts                 # Backend discovery, spawn lock, version-skew handling
│   └── registry.ts              # singleton.json / singleton.lock read-write helpers
├── auth/
│   └── auth-manager.ts         # Google auth: login, cookies, state persistence
├── session/
│   ├── session-manager.ts      # Session lifecycle, cleanup, limits
│   ├── browser-session.ts      # Page interactions, question/answer flow
│   └── shared-context-manager.ts # Shared browser context (fingerprint)
├── library/
│   ├── notebook-library.ts     # Notebook collection management (CRUD)
│   └── types.ts                # Library-specific types
├── tools/
│   ├── index.ts                # Exports definitions + handlers
│   ├── definitions.ts          # Tool definitions aggregator
│   ├── handlers.ts             # Tool implementation logic
│   ├── definitions/
│   │   ├── ask-question.ts     # Core tool with structuring guidelines
│   │   ├── notebook-management.ts # Library tools
│   │   ├── session-management.ts # Session tools
│   │   └── system.ts           # Health, auth, cleanup tools
│   └── templates/
│       └── structuring-guidelines.ts # Prompt structuring template
├── resources/
│   └── resource-handlers.ts    # MCP resources for notebooks
└── utils/
    ├── cleanup-manager.ts      # Deep cleanup of browser data
    ├── cli-handler.ts          # CLI config commands
    ├── connection-checker.ts   # Chrome state detection
    ├── logger.ts               # Colored console logging (testable with DI)
    ├── page-utils.ts           # Response detection, streaming handling
    ├── settings-manager.ts     # Profile-based tool filtering
    └── stealth-utils.ts        # Human-like typing/mouse
```

## Conventions

### Code Style

- **Comments**: English, JSDoc for public functions
- **Imports**: Named imports, `.js` extension for relative paths
- **Async**: Prefer async/await over callbacks
- **Logging**: Use `log.info/success/warning/error` from `utils/logger.ts`
- **Errors**: Throw custom errors from `errors.ts` where appropriate

### Naming

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/methods: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Interfaces: `PascalCase` (e.g., `SessionInfo`, `ToolResult`)

### Architecture Patterns

- **Manager pattern**: `AuthManager`, `SessionManager`, `NotebookLibrary`
- **Handler pattern**: `ToolHandlers` class with methods per tool
- **Config priority**: Defaults → ENV → Tool parameters (runtime)
- **Session lifecycle**: Create → Use → Cleanup (auto after timeout)
- **Shared context**: Single browser context, multiple pages (tabs)

## Key Concepts

### Client-Side Prompt Structuring

The core differentiator from upstream. Tool descriptions include structuring guidelines that instruct Claude to:

1. Transform simple questions into structured prompts with constraints
2. Enforce source fidelity (only document content, no external knowledge)
3. Require citations and explicit "NOT FOUND" declarations
4. Adapt structure based on question type (comparison, list, analysis, etc.)

Guidelines template is in `src/tools/templates/structuring-guidelines.ts`.

### Authentication Flow

1. Check saved cookies in `browser_state/state.json`
2. Validate cookie expiry (critical cookies: SID, HSID, etc.)
3. If invalid: auto-auth (works even if Chrome is already running)
4. Persist to both state file AND Chrome profile directory

### Session Management

- Sessions are per-notebook, identified by random hex ID
- Each session = one browser tab in shared context
- Auto-cleanup after `SESSION_TIMEOUT` (default 15 min)
- Max `MAX_SESSIONS` concurrent (default 10)

## Review Focus

When reviewing this codebase, pay attention to:

- **Selector stability**: All NotebookLM DOM selectors are centralized in `selectors.ts` - update there if UI breaks
- **Rate limiting**: Free accounts have 50 queries/day limit
- **Cookie persistence**: Session cookies with `-1` expiry need Chrome profile persistence
- **Stealth detection**: Patchright settings in `stealth-utils.ts` may need updates
- **Error recovery**: `browser-session.ts` uses `isPageClosedError()` from `errors.ts` for auto-recovery
- **Timing constants**: All timeouts/delays are configurable in `config.ts`

## Commands

```bash
npm run build         # Compile TypeScript to dist/
npm run dev           # Watch mode with tsx (implies NOTEBOOK_SINGLETON=false: the proxy can't spawn a .ts backend)
npm run start         # Run compiled server (proxy role by default)
npm run test          # Run server directly with tsx (for testing)
npm run test:unit     # node:test unit tests for the singleton module (src/singleton/*.test.ts)
npm run test:singleton # Integration test: two concurrent proxies, one spawned backend, clean shutdown
```

## Environment Variables

Key variables (see `config.ts` for full list):

- `NOTEBOOK_URL` - Default notebook URL
- `HEADLESS` - Browser visibility (true/false)
- `MAX_SESSIONS` - Concurrent session limit
- `SESSION_TIMEOUT` - Inactivity timeout in seconds
- `AUTO_LOGIN_ENABLED` - Enable credential-based login
- `LOGIN_EMAIL`, `LOGIN_PASSWORD` - Auto-login credentials
- `STEALTH_*` - Human-like behavior settings
- `NOTEBOOK_SINGLETON` - `true|false` (default `true`) - `false` runs the legacy direct stdio server, skipping the proxy/backend split
- `NOTEBOOK_BACKEND_GRACE_MS` - Idle grace, in ms, before the shared backend exits after its last client disconnects (default `60000`)

## Data Paths

Cross-platform via `env-paths` (`suffix: ""`, so no `-nodejs` suffix is appended):

- **Windows**: `%LOCALAPPDATA%\notebooklm-mcp\Data\` (measured 2026-08-20; `env-paths` appends `\Data` to `%LOCALAPPDATA%\notebooklm-mcp` on Windows only)
- **macOS**: `~/Library/Application Support/notebooklm-mcp/`
- **Linux**: `~/.local/share/notebooklm-mcp/` (or `$XDG_DATA_HOME/notebooklm-mcp/` if set)

Contents:

- `browser_state/` - Cookies, localStorage exports
- `chrome_profile/` - Persistent Chrome profile
- `library.json` - Notebook collection
- `singleton.json` - Shared backend's port, bearer token, pid, and version (singleton mode only)
- `singleton.lock` - Spawn lock held briefly by whichever proxy is starting the backend (singleton mode only)
- `logs/backend.log` - Backend log output, truncated at the start of each run (singleton mode only)

---

*Last updated: 2026-08-20 after the singleton backend (Task 10).*
