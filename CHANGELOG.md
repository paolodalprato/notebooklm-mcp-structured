# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2025-01-27

### Fixed
- **Critical: NotebookLM timeout issue** - Removed decorative lines (`===` and `---`) from structured prompts
  - **Root cause**: NotebookLM interpreted lines of `=` or `-` characters as invalid formatting
  - **Impact**: System would timeout waiting for NotebookLM response
  - **Solution**: Changed to plain text section headers without decoration
  - **Files changed**: `src/utils/prompt-enhancer.ts`
  - **Documentation updated**: README.md, CUSTOM_MODIFICATIONS.md now show correct format

## [1.0.0] - 2025-01-27

### Added - Initial Release

This is the first release of **notebooklm-mcp-structured**, a fork of [notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp) with enhanced features for professional use cases requiring document fidelity.

#### 🎯 Structured Prompt Enhancement
- **Automatic prompt structuring** - Transforms simple questions into well-engineered prompts
- **Question type detection** - Automatically detects and applies appropriate structure:
  - Comparison (compare, vs, difference)
  - List (list, which, identify)
  - Analysis (analyze, examine, evaluate)
  - Explanation (explain, why, how)
  - Extraction (default)
- **Explicit constraints** - Defines task, scope, and operational constraints
- **Citation requirements** - Enforces source attribution and explicit quotes
- **Missing information handling** - Requires explicit declaration of unavailable data
- **Multi-language support** - Italian and English with auto-detection

#### 🛡️ Response Wrapper (Claude Containment)
- **Claude containment instructions** - Prevents Claude from adding external knowledge
- **Source fidelity enforcement** - Ensures responses use only document-provided information
- **Two modes available**:
  - `strict` - No external knowledge allowed
  - `balanced` - Synthesis allowed with clear labeling

#### ⚙️ Configuration System
- **Environment variable configuration**:
  - `NOTEBOOKLM_ENHANCE_PROMPTS` - Enable/disable prompt enhancement
  - `NOTEBOOKLM_PROMPT_MODE` - strict/balanced mode for prompts
  - `NOTEBOOKLM_PROMPT_LANGUAGE` - en/it/auto language selection
  - `NOTEBOOKLM_WRAP_RESPONSES` - Enable/disable response wrapping
  - `NOTEBOOKLM_WRAPPER_MODE` - strict/balanced mode for responses
- **Per-call parameter override** - All settings can be overridden per query

#### 📚 Documentation
- Comprehensive README with installation guides
- Use case examples (legal, research, fact-checking)
- Architecture overview
- Configuration reference

### Technical Details

- **Node.js** >= 18.0.0 required
- **TypeScript** implementation
- **MCP SDK** 1.0.0 integration
- **MIT License** (maintains original license)

### Credits

- **Original notebooklm-mcp**: [Gérôme Dexheimer](https://github.com/PleasePrompto/notebooklm-mcp)
- **Structured Prompts & Source Fidelity**: Paolo Dal Prato

[1.0.0]: https://github.com/paolodalprato/notebooklm-mcp-structured/releases/tag/v1.0.0
