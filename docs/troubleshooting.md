## Troubleshooting

> **NotebookLM MCP Structured v1.0.0** - Troubleshooting guide for structured prompts and source fidelity.

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

### Chrome must be closed
- **Symptom**: "Please close Chrome before authentication setup"
- **Fix**: Close ALL Chrome/Chromium windows, then retry `setup_auth`

### Auto-auth not triggering
- **Symptom**: `ask_question` fails without opening login
- **Fix**: Run `get_health` first to check status, then `setup_auth` manually

---

## General Issues

### Fresh start / Deep cleanup
If you're experiencing persistent issues, corrupted data, or want to start completely fresh:

**⚠️ CRITICAL: Close ALL Chrome/Chromium instances before cleanup!** Open browsers can prevent cleanup and cause issues.

**Recommended workflow:**
1. Close all Chrome/Chromium windows and instances
2. Ask: "Run NotebookLM cleanup and preserve my library"
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
- Cause: Another Chrome is using the base profile.
- Fix: `NOTEBOOK_PROFILE_STRATEGY=auto` (default) falls back to isolated per‑instance profiles; or set `isolated`.

### Authentication issues
**Quick fix:** Ask the agent to repair authentication; it will run `get_health` → `setup_auth` → `get_health`.

**For persistent auth failures:**
1. Close ALL Chrome/Chromium instances
2. Ask: "Run NotebookLM cleanup with library preservation"
3. After cleanup completes, ask: "Open NotebookLM auth setup"
4. This creates a completely fresh browser session while keeping your notebooks

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
