# NotebookLM MCP Structured

Enhanced MCP server for NotebookLM with client-side prompt structuring for source fidelity in professional document analysis.

## Stack

- **Language**: TypeScript (ES2022, Node16 modules)
- **Runtime**: Node.js >= 18.0.0
- **Framework**: MCP SDK (@modelcontextprotocol/sdk)
- **Browser automation**: Patchright (Playwright fork with stealth features)
- **Validation**: Zod
- **Testing**: None configured (manual testing via `tsx src/index.ts`)

## Structure

```
src/
├── index.ts                    # Entry point: NotebookLMMCPServer class, MCP setup
├── config.ts                   # Configuration: defaults, ENV overrides, paths, timing constants
├── errors.ts                   # Custom errors + page closed detection helper
├── selectors.ts                # Centralized DOM selectors for NotebookLM UI
├── types.ts                    # Global TypeScript interfaces
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
3. If invalid: auto-auth if Chrome closed, else prompt user
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
npm run build    # Compile TypeScript to dist/
npm run dev      # Watch mode with tsx
npm run start    # Run compiled server
npm run test     # Run server directly with tsx (for testing)
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

## Data Paths

Cross-platform via `env-paths`:

- **Windows**: `%APPDATA%\notebooklm-mcp\`
- **macOS**: `~/Library/Application Support/notebooklm-mcp/`
- **Linux**: `~/.local/share/notebooklm-mcp/`

Contents:

- `browser_state/` - Cookies, localStorage exports
- `chrome_profile/` - Persistent Chrome profile
- `library.json` - Notebook collection

---

*Last updated: 2025-01 after code-review refactoring.*
