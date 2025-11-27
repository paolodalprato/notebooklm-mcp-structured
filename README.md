# NotebookLM MCP Structured

Enhanced MCP server for NotebookLM with **structured prompts** and **source fidelity controls**.

This is a modified version of [notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp) that adds two key features for professional use cases where document fidelity is critical (legal analysis, research, fact-checking).

## Key Features

### 1. Structured Prompt Enhancement

Transforms simple questions into well-engineered prompts that:
- Define explicit task, scope, and constraints
- Specify output format based on question type (comparison, list, analysis, extraction, explanation)
- Require citations and source attribution
- Handle missing information explicitly

**Before (simple question):**
```
Analizza le sentenze presenti nei documenti
```

**After (structured prompt):**
```
ISTRUZIONI PER LA RISPOSTA

COMPITO: Analizza le sentenze presenti nei documenti

VINCOLI OPERATIVI
- Usa ESCLUSIVAMENTE informazioni esplicite nei documenti caricati
- NON aggiungere conoscenze esterne, interpretazioni o inferenze
- Se un'informazione non è presente, dichiara: "[NON PRESENTE NEI DOCUMENTI]"

FORMATO OUTPUT RICHIESTO
[Auto-detected structure based on question type]

CITAZIONI
- Ogni affermazione DEVE includere la fonte
- Usa citazioni dirette tra virgolette dove possibile
- Formato citazione: "testo citato" [Fonte: nome documento]

GESTIONE INFORMAZIONI MANCANTI
- Se l'informazione richiesta non è nei documenti, dichiaralo esplicitamente

INIZIO RISPOSTA STRUTTURATA
```

**Note**: The prompt uses plain text headers WITHOUT decorative lines (no `===` or `---`) to prevent NotebookLM timeout issues.

### 2. Response Wrapper (Claude Containment)

Adds instructions to NotebookLM responses that tell Claude NOT to add external knowledge. This prevents Claude from "enriching" responses with information not present in the source documents.

## Installation

### Prerequisites

- Node.js >= 18.0.0
- npm
- A Google account for NotebookLM access

### Install from GitHub

```bash
# Clone the repository
git clone https://github.com/paolodalprato/notebooklm-mcp-structured.git

# Enter directory
cd notebooklm-mcp-structured

# Install dependencies
npm install

# Build
npm run build
```

### Configure Claude Desktop

Add to your `claude_desktop_config.json`:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "notebooklm": {
      "command": "node",
      "args": [
        "/absolute/path/to/notebooklm-mcp-structured/dist/index.js"
      ],
      "env": {
        "NOTEBOOKLM_ENHANCE_PROMPTS": "true",
        "NOTEBOOKLM_PROMPT_MODE": "strict",
        "NOTEBOOKLM_WRAP_RESPONSES": "true",
        "NOTEBOOKLM_WRAPPER_MODE": "strict"
      }
    }
  }
}
```

**Windows example:**
```json
{
  "mcpServers": {
    "notebooklm": {
      "command": "node",
      "args": [
        "D:\\path\\to\\notebooklm-mcp-structured\\dist\\index.js"
      ],
      "env": {
        "NOTEBOOKLM_ENHANCE_PROMPTS": "true",
        "NOTEBOOKLM_PROMPT_MODE": "strict",
        "NOTEBOOKLM_WRAP_RESPONSES": "true",
        "NOTEBOOKLM_WRAPPER_MODE": "strict"
      }
    }
  }
}
```

### First-time Authentication

After restarting Claude Desktop:
1. Ask Claude to check NotebookLM health: `Check notebooklm health`
2. If not authenticated, ask: `Setup notebooklm authentication`
3. A browser window will open for Google login
4. Complete login and close the browser

## Configuration

### Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `NOTEBOOKLM_ENHANCE_PROMPTS` | `true`/`false` | `true` | Enable structured prompt enhancement |
| `NOTEBOOKLM_PROMPT_MODE` | `strict`/`balanced` | `strict` | Strict = no external knowledge; Balanced = synthesis allowed |
| `NOTEBOOKLM_PROMPT_LANGUAGE` | `en`/`it`/`auto` | `auto` | Language for prompt instructions |
| `NOTEBOOKLM_WRAP_RESPONSES` | `true`/`false` | `true` | Add containment instructions to responses |
| `NOTEBOOKLM_WRAPPER_MODE` | `strict`/`balanced` | `strict` | Strength of containment instructions |

### Per-call Parameters

Override settings for individual queries:

```javascript
ask_question({
  question: "Your question",
  notebook_id: "your-notebook",
  enhance_prompt: true,
  prompt_mode: "strict",
  prompt_language: "it",
  wrap_response: true,
  wrapper_mode: "strict"
})
```

## Use Cases

### Legal Document Analysis
- Extract specific clauses with citations
- Compare rulings across cases
- Identify patterns in jurisprudence

### Research
- Literature review with source tracking
- Fact extraction from multiple documents
- Cross-reference verification

### Professional Fact-Checking
- Verify claims against source documents
- Identify what's explicitly stated vs. inferred
- Maintain audit trail with citations

## How It Works

### Question Type Detection

The enhancer automatically detects question type and applies appropriate structure:

| Type | Trigger Words | Output Structure |
|------|--------------|------------------|
| Comparison | "compare", "vs", "difference" | Elements, Similarities, Differences, Synthesis |
| List | "list", "which", "identify" | Elements with descriptions and sources |
| Analysis | "analyze", "examine", "evaluate" | Subject, Observations, Patterns, Conclusions |
| Explanation | "explain", "why", "how" | Concept, Answer, Examples, Related info |
| Extraction | (default) | Data, Quotes, Sources |

### Language Support

Currently supports:
- 🇮🇹 Italian
- 🇬🇧 English

Language is auto-detected from the question or can be set explicitly.

## Architecture

```
Claude <---> NotebookLM MCP Custom <---> NotebookLM (Gemini)
                    |
                    ├── prompt-enhancer.ts  (structures outgoing prompts)
                    └── response-wrapper.ts (adds containment to responses)
```

The key insight: NotebookLM provides source-faithful extraction, Claude provides reasoning and synthesis. This MCP ensures the boundary is respected.

## Credits

- Original `notebooklm-mcp`: [Gérôme Dexheimer](https://github.com/PleasePrompto/notebooklm-mcp)
- Modifications: Paolo Dalprato

## License

MIT
