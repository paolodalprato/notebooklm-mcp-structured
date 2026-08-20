## Troubleshooting

> **NotebookLM MCP Structured v1.1.0** - Troubleshooting guide for structured prompts and source fidelity.

---

## Structured Prompts Issues

### NotebookLM timeout / No response
- **Cause**: Decorative lines (`===` or `---`) in the prompt
- **Fix**: The structured fork automatically avoids these. If you customized `ask-question.ts`, ensure NO decorative separators.

### Responses include external knowledge
- **Cause**: Prompt structuring not applied correctly
- **Fix**:
  1. Verify you're using `ask_question` tool (structuring is automatic)
  2. Check `src/tools/definitions/ask-question.ts` hasn't been modified incorrectly
  3. Rebuild with `npm run build` and restart Claude Desktop

### Missing citations in response
- **Cause**: NotebookLM didn't follow structuring instructions
- **Fix**: Ask a more specific question. General questions may produce less structured responses.

### `[NOT FOUND IN DOCUMENTS]` appears unexpectedly
- **Cause**: The requested information isn't in your uploaded documents
- **This is expected behavior** - it means source fidelity is working correctly!

---

## Authentication Issues

### Auto-auth not triggering
- **Symptom**: `ask_question` fails without opening login
- **Fix**: Run `get_health` first to check status, then `setup_auth` manually

---

## Singleton Backend Issues

Since v1.1.0, `dist/index.js` launched by Claude Desktop is a lightweight **proxy**; it spawns (or connects to) a single shared **backend** process that actually drives Chrome. This is what lets Chat and Cowork query NotebookLM at the same time — they now share one browser through one backend instead of racing for the same Chrome profile.

### Where the backend logs go
- The backend writes to `logs/backend.log` in the [data directory](configuration.md#storage-paths) (`%LOCALAPPDATA%\notebooklm-mcp\Data\logs\backend.log` on Windows), truncated at the start of every backend run.
- The proxy itself logs to stderr, same as before — check Claude Desktop's MCP server logs for proxy-side errors (failed spawn, unreachable backend, etc.).

### Backend seems stuck / not responding
- **Symptom**: `ask_question` or `get_health` hangs or times out, and it did not before.
- **Fix**:
  1. Check `logs/backend.log` for the actual error.
  2. Close Claude Desktop entirely (all surfaces), so no proxy is holding a connection.
  3. Delete `singleton.json` from the data directory (the backend's own registration file — this does not touch `browser_state/`, `chrome_profile/`, or `library.json`).
  4. Restart Claude Desktop. The first surface to start spawns a fresh backend automatically.
- If the backend process itself is wedged, it will not release its port until killed manually (find it via the `pid` field in `singleton.json`, or the pid logged in `backend.log`) — deleting `singleton.json` alone does not stop it, only stops proxies from trying to reuse it.
- To bypass the singleton entirely while debugging, set `NOTEBOOK_SINGLETON=false` and restart: this runs the legacy direct stdio server with no proxy/backend split.

---

## General Issues

### Fresh start / Deep cleanup
If you're experiencing persistent issues, corrupted data, or want to start completely fresh:

**Recommended workflow:**
1. Ask: "Run NotebookLM cleanup and preserve my library"
3. Review the preview - you'll see exactly what will be deleted
4. Confirm deletion
5. Re-authenticate: "Open NotebookLM auth setup"

**What gets cleaned:**
- Browser data, cache, Chrome profiles
- Temporary files and logs
- Old installation data
- **Preserved:** Your notebook library (when using preserve option)

**Useful for:**
- Authentication problems
- Browser session conflicts
- Corrupted browser profiles
- Clean reinstalls
- Switching between accounts

### Browser closed / `newPage` errors
- Symptom: `browserContext.newPage: Target page/context/browser has been closed`.
- Fix: The server auto‑recovers (recreates context and page). Re‑run the tool.

### Profile lock / `ProcessSingleton` errors
- Since v1.1.0 this should no longer happen in normal use: the singleton backend gives Chat and Cowork exactly one shared Chrome process, so there is nothing left inside this server to contend for the profile.
- Cause (if it still occurs): some other Chrome — a manually launched one, or a stray process from an old version — is using the base profile.
- Fix: `NOTEBOOK_PROFILE_STRATEGY=auto` (default) falls back to an isolated per-instance profile; or set `isolated`. Note this fallback usually cannot authenticate on its own — Google treats a fresh profile as a new device and asks for a full interactive login — so treat it as a way to keep the server usable while you resolve the underlying profile conflict, not a silent fix.

### Authentication issues
**Quick fix:** Ask the agent to repair authentication; it will run `get_health` → `setup_auth` → `get_health`.

**For persistent auth failures:**
1. Ask: "Run NotebookLM cleanup with library preservation"
2. After cleanup completes, ask: "Open NotebookLM auth setup"
3. This creates a completely fresh browser session while keeping your notebooks

**Auto-login (optional):**
- Set `AUTO_LOGIN_ENABLED=true` with `LOGIN_EMAIL`, `LOGIN_PASSWORD` environment variables
- For automation workflows only

### Typing speed too slow/fast
- Adjust `TYPING_WPM_MIN`/`MAX`; or disable stealth typing by setting `STEALTH_ENABLED=false`.

### Rate limit reached
- Symptom: "NotebookLM rate limit reached (50 queries/day for free accounts)".
- Fix: Use `re_auth` tool to switch to a different Google account, or wait until tomorrow.
- Upgrade: Google AI Pro/Ultra gives 5x higher limits.

### No notebooks found
- Ask to add the NotebookLM link you need.
- Ask to list the stored notebooks, then choose the one to activate.
