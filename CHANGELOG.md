# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
