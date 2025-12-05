## Tools

> **NotebookLM MCP Structured v1.0.0** - Tools with automatic prompt structuring and source fidelity.

### Core Tools (with Auto-Auth)

Tools marked with 🔐 automatically verify authentication and trigger login if needed.

- `ask_question` 🔐
  - **Key Feature**: Automatically structures your question for source fidelity
  - Parameters: `question` (string, required), optional `session_id`, `notebook_id`, `notebook_url`, `show_browser`
  - **Structuring includes**:
    - Source constraints (ONLY from uploaded documents)
    - Citation requirements (source attribution for every claim)
    - Missing info handling (`[NOT FOUND IN DOCUMENTS]`)
    - Question type detection (comparison, list, analysis, explanation, extraction)
  - Returns NotebookLM's source-faithful answer plus follow-up reminder
  - ⚠️ Never include decorative lines (`===` or `---`) - causes timeouts

- `reset_session` 🔐
  - Reset a session to start fresh
  - Triggers auto-auth if needed

- `list_sessions`, `close_session`
  - Inspect or manage active browser sessions (no auth required)

### Authentication & Diagnostics

- `get_health`
  - **Enhanced diagnostics**: Auth status, Chrome state, connection verification
  - Shows if Chrome is running (blocks auth setup)
  - Reports active sessions and configuration

- `setup_auth`
  - Opens persistent Chrome profile for Google login
  - ⚠️ Requires Chrome to be closed first

- `re_auth`
  - Switch to a different Google account or re-authenticate
  - Use when NotebookLM rate limit is reached (50 queries/day for free accounts)
  - Closes all sessions, clears auth data, opens browser for fresh login

### Notebook library
- `add_notebook` – Safe conversational add; expects confirmation before writing.
- `list_notebooks` – Returns id, name, topics, URL, metadata for every entry.
- `get_notebook` – Fetch a single notebook by id.
- `select_notebook` – Set the active default notebook.
- `update_notebook` – Modify metadata fields.
- `remove_notebook` – Removes entries from the library (not the original NotebookLM notebook).
- `search_notebooks` – Simple query across name/description/topics/tags.
- `get_library_stats` – Aggregate statistics (total notebooks, usage counts, etc.).

### Resources
- `notebooklm://library`
  - JSON representation of the full library: active notebook, stats, individual notebooks.
- `notebooklm://library/{id}`
  - Fetch metadata for a specific notebook. The `{id}` completion pulls from the library automatically.

**Remember:** Every `ask_question` response ends with a reminder that nudges your agent to keep asking until the user’s task is fully addressed.
