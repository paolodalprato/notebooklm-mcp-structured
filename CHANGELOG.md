# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-20

Final release. Development is frozen and the repository is archived; future work continues in a successor project built on version 2 of the MCP protocol.

### Added

- **Singleton backend**: one shared browser process behind authenticated localhost Streamable HTTP; the stdio entry point became a transparent proxy, so concurrent Claude Desktop surfaces (Chat and Cowork) can query notebooks at the same time
- Automatic backend discovery with spawn locking, version-skew handover, and reconnection with handshake replay when the backend dies mid-conversation
- Unit tests (`npm run test:unit`) and a two-surface integration test (`npm run test:singleton`)
- `NOTEBOOK_SINGLETON` and `NOTEBOOK_BACKEND_GRACE_MS` environment variables

### Changed

- Followed Google's July 2026 rename: NotebookLM is now **Gemini Notebook** at `notebook.google.com` (new host, new notebook URLs, redesigned answer UI, redirect chain handled)
- Moved to MCP SDK 1.30.0, the latest release for version 1 of the MCP protocol
- Answer extraction rewritten for the new Notebook UI; response wait raised to 5 minutes and made configurable
- Prompt structuring guidelines rewritten (v3)

### Fixed

- Auth reliability: Chromium sandbox enabled, no more Chrome-blocking auth flow; a profile that cannot sign itself in now fails fast with an accurate message
- Browser released when the last session ends and when a session fails to start, ending orphan Chrome processes and cross-surface profile contention

## [1.0.0] - 2025-01-27

### Added - Initial Release

This is the first release of **notebooklm-mcp-structured**, a fork of [notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp) with client-side prompt structuring for professional use cases requiring document fidelity.

#### 🎯 Client-Side Prompt Structuring

**Core Innovation:**
- **Structuring guidelines embedded in tool description** - Instructs Claude on how to structure questions
- **No server-side processing** - Questions pass through directly to NotebookLM
- **Language support** - Adapts to user's language (tested with Italian, designed for all languages)
- **Flexible adaptation** - Claude adjusts structure based on context and question type

**Implementation:**
- Comprehensive guidelines in `ask_question` tool description (~120 lines)
- Question type detection and adaptation (comparison, list, analysis, explanation, extraction)
- Multilingual examples (Italian, English) as templates
- Response handling instructions to prevent external knowledge addition

**Key Features:**
- **Source fidelity enforcement**: Responses come ONLY from uploaded documents
- **Citation requirements**: Every claim must include source attribution
- **Missing information handling**: Explicit declaration when data unavailable
- **No decorative lines**: Plain text headers prevent NotebookLM timeouts

#### 📚 Documentation

- Comprehensive README with installation and usage guide
- CUSTOM_MODIFICATIONS.md explaining design decisions
- Use case examples (legal analysis, research, fact-checking)
- FAQ section addressing common questions

#### 🏗️ Architecture

**Simplified Design:**
- Client-side structuring (Claude transforms questions)
- Server passes questions directly without modification
- No language detection or template management needed
- Single source of truth (tool description)

**Files Modified:**
- `src/tools/definitions/ask-question.ts` - Added structuring guidelines
- `src/tools/handlers.ts` - Simplified to pass questions directly

**Files Removed:**
- No server-side enhancement files (prompt-enhancer, response-wrapper)

### Technical Details

- **Node.js** >= 18.0.0 required
- **TypeScript** implementation
- **MCP SDK** 1.0.0 integration
- **MIT License** (maintains original license)

### Design Philosophy

**Why Client-Side?**
1. Language adaptation through Claude (tested with Italian)
2. Simpler architecture (no server-side templates)
3. More flexible (context-aware adaptation)
4. Easier to maintain (single source of guidelines)
5. Future-proof (updates only require tool description changes)
6. Community feedback welcome for other languages

**Critical Discovery:**
- Decorative lines (`===`, `---`) cause NotebookLM timeouts
- Plain text section headers work reliably
- This finding informed the guideline formatting

### Credits

- **Original notebooklm-mcp**: [Gérôme Dexheimer](https://github.com/PleasePrompto/notebooklm-mcp)
- **Client-Side Structuring Approach**: Paolo Dalprato

[1.0.0]: https://github.com/paolodalprato/notebooklm-mcp-structured/releases/tag/v1.0.0
