# NotebookLM MCP Structured

Enhanced MCP server for NotebookLM with **client-side prompt structuring** for **source fidelity**.

> **Requirements:** This MCP server is designed to work with **Claude Desktop**. It requires Claude Desktop to be installed and configured to use MCP servers.

This is a modified version of [notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp) that adds comprehensive structuring instructions to guide Claude in crafting prompts that enforce document fidelity for professional use cases (legal analysis, research, fact-checking).

## Key Features

### Client-Side Prompt Structuring

The MCP tool description includes comprehensive guidelines that instruct Claude on how to structure questions before sending them to NotebookLM. This ensures:

- **Source fidelity**: Responses come ONLY from uploaded documents
- **Citation requirements**: Every claim includes source attribution
- **Missing information handling**: Explicit declaration when data is unavailable
- **Multi-language support**: Works naturally with any language Claude supports
- **Question type adaptation**: Different structures for comparisons, lists, analyses, explanations, and extractions

**How It Works:**

1. User asks a simple question in any language
2. Claude reads the structuring guidelines from the tool description
3. Claude transforms the question into a well-structured prompt
4. NotebookLM receives the structured prompt and responds accordingly
5. Claude presents the response faithfully without adding external knowledge

**Example Transformation:**

Simple question:
```
What are the main findings in the research papers?
```

Claude structures it as:
```
RESPONSE INSTRUCTIONS

TASK: What are the main findings in the research papers?

OPERATIONAL CONSTRAINTS
- Use ONLY information explicitly present in uploaded documents
- DO NOT add external knowledge or interpretations
- If information is not present, state: "[NOT FOUND IN DOCUMENTS]"

REQUIRED OUTPUT FORMAT
For each finding:
- FINDING: [description]
- SOURCE: [document name/section]
- QUOTE: "direct quote supporting the finding"

CITATIONS
- Every claim MUST include source
- Use direct quotes where possible

HANDLING MISSING INFORMATION
- If information is missing, declare it explicitly

BEGIN STRUCTURED RESPONSE
```

**Critical Formatting Rule:**
- **NO decorative lines** (no `===` or `---`) as they cause NotebookLM timeouts

### Language Support

**Tested with Italian** - works perfectly with Italian users and documents.

**Other languages**: The system adapts to the user's language (detected from user profile/context). If you use notebooklm-mcp-structured with a language other than Italian, please share your experience!

**How it works:**
- Claude detects your language from your profile/context
- Structuring instructions are translated to your language
- NotebookLM responds in the same language
- No configuration needed

**Seeking testers**: If you use languages other than Italian, we'd love to hear if it works well for you. Please open an issue on GitHub with your feedback!

### Automatic Connection Verification

The MCP server automatically verifies the connection to NotebookLM before executing any operation that requires it. This ensures a smooth user experience:

**How it works:**
1. When you make a request that requires NotebookLM (e.g., asking a question), the server checks if authentication is valid
2. If authentication is expired or missing:
   - **Chrome is running:** You'll receive a message asking to close Chrome first
   - **Chrome is closed:** A browser window opens automatically for Google login
3. After successful login, your original request proceeds automatically

**No manual intervention needed** - the server handles authentication seamlessly within the conversation flow.

## Installation

### Prerequisites

- **Claude Desktop** - Required to use this MCP server
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
      ]
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
      ]
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

## Use Cases

### Legal Document Analysis
- Extract specific clauses with citations
- Compare rulings across cases
- Identify patterns in jurisprudence
- Ensure responses come only from case documents

### Research
- Literature review with source tracking
- Fact extraction from multiple documents
- Cross-reference verification
- Prevent mixing document content with external knowledge

### Professional Fact-Checking
- Verify claims against source documents
- Identify what's explicitly stated vs. inferred
- Maintain audit trail with citations
- Ensure complete transparency of information sources

## Architecture

```
User Question → Claude (reads structuring guidelines) → Structured Prompt → NotebookLM (Gemini) → Source-Faithful Response → User
```

### Why Client-Side Structuring?

**Advantages:**
1. **Multilingual by default**: Claude naturally handles any language
2. **Simpler architecture**: No server-side template management
3. **Flexible adaptation**: Claude adjusts structure based on context
4. **Future-proof**: Updates to structuring logic just require tool description changes

**How It Works:**
- Structuring guidelines embedded in tool description
- Claude reads guidelines and applies them to user questions
- No server-side processing or language detection needed
- Works seamlessly across all languages Claude supports

### Question Type Detection

Claude automatically detects question type and applies appropriate structure:

| Type | Trigger Words | Output Structure |
|------|--------------|------------------|
| Comparison | "compare", "vs", "difference" | Elements, Similarities, Differences, Synthesis |
| List | "list", "identify", "which" | Numbered items with descriptions and sources |
| Analysis | "analyze", "examine", "evaluate" | Subject, Observations, Evidence, Conclusions |
| Explanation | "explain", "why", "how" | Concept, Answer, Examples, Related info |
| Extraction | (default) | Data points with quotes and sources |

## Tools Available

### Core Tools (require NotebookLM connection)
- `ask_question` - Ask questions to NotebookLM with session management *(triggers auto-auth if needed)*
- `reset_session` - Reset a session to start fresh *(triggers auto-auth if needed)*

### Session Management
- `list_sessions` - View all active conversation sessions
- `close_session` - Close a specific session

### Authentication & Diagnostics
- `get_health` - Check authentication, connection status, and Chrome state *(enhanced diagnostics)*
- `setup_auth` - Initial Google login
- `re_auth` - Switch Google accounts or recover from rate limits

### Notebook Library Management
- `add_notebook` - Add a notebook to your library
- `list_notebooks` - View all notebooks in your library
- `get_notebook` - Get details of a specific notebook
- `select_notebook` - Set active notebook
- `update_notebook` - Update notebook metadata
- `remove_notebook` - Remove notebook from library
- `search_notebooks` - Search notebooks by keywords
- `get_library_stats` - View library statistics

### Maintenance
- `cleanup_data` - Clean up browser data and authentication files

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Credits

- Original `notebooklm-mcp`: [Gérôme Dexheimer](https://github.com/PleasePrompto/notebooklm-mcp)
- Client-side structuring approach: Paolo Dalprato

## License

MIT

---

## FAQ

**Q: Does this work with Claude Code or other MCP clients?**
A: This MCP server is specifically designed for **Claude Desktop**. While other MCP-compatible clients might work, the automatic connection verification and authentication flow are optimized for the Claude Desktop experience.

**Q: Does this work with languages other than Italian?**
A: The system is designed to work with any language Claude supports. It has been tested with Italian and works perfectly. If you use another language, the system should adapt automatically to your profile language. We're seeking feedback from users of other languages!

**Q: Why not use server-side templates?**
A: Client-side structuring is simpler, more flexible, and naturally multilingual. Claude can adapt the structure to context better than fixed templates.

**Q: Can I customize the structuring guidelines?**
A: The guidelines are embedded in the tool description (`src/tools/definitions/ask-question.ts`). You can modify them and rebuild.

**Q: What happens if I don't structure my prompts?**
A: NotebookLM might mix document content with its general knowledge. Structured prompts enforce source fidelity.

**Q: Are there any rate limits?**
A: Free Google accounts have 50 queries/day to NotebookLM. Google AI Pro/Ultra accounts have 5x higher limits.
