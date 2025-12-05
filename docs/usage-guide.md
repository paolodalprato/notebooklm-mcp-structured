# Usage Guide - Structured Prompts & Source Fidelity

> **NotebookLM MCP Structured v1.0.0** - Client-side prompt structuring for professional document analysis.

This guide covers usage patterns optimized for **source fidelity** - ensuring responses come ONLY from your uploaded documents with proper citations.

> For installation and quick start, see the main [README](../README.md).

---

## Core Concept: Structured Prompts

Unlike the original MCP server, this fork **automatically transforms** your questions into structured prompts that enforce:

1. **Source constraints**: NotebookLM uses ONLY your uploaded documents
2. **Citations**: Every claim includes document source attribution
3. **Explicit gaps**: Missing information declared as `[NOT FOUND IN DOCUMENTS]`
4. **Consistent format**: Output structured by question type

### How It Works

```
Your question: "What are the main findings?"

Claude structures it as:
┌─────────────────────────────────────────────┐
│ RESPONSE INSTRUCTIONS                       │
│                                             │
│ TASK: What are the main findings?           │
│                                             │
│ OPERATIONAL CONSTRAINTS                     │
│ - Use ONLY information from documents       │
│ - DO NOT add external knowledge             │
│ - If not found: "[NOT FOUND IN DOCUMENTS]"  │
│                                             │
│ REQUIRED OUTPUT FORMAT                      │
│ For each finding:                           │
│ - FINDING: [description]                    │
│ - SOURCE: [document name/section]           │
│ - QUOTE: "direct quote"                     │
│                                             │
│ BEGIN STRUCTURED RESPONSE                   │
└─────────────────────────────────────────────┘

NotebookLM responds with source-faithful answer
```

**You just ask naturally** - Claude handles the structuring automatically.

---

## Use Cases

### Legal Document Analysis

Perfect for ensuring responses come only from case documents:

```
"Compare the rulings in Case A vs Case B"
→ Structured as comparison with source citations

"Extract all clauses related to liability"
→ Structured as extraction with document references

"What does the contract say about termination?"
→ Source-faithful answer or [NOT FOUND IN DOCUMENTS]
```

### Research & Literature Review

```
"What methodology did the authors use?"
→ Direct quotes from methodology section

"Summarize the key findings across all papers"
→ Findings attributed to specific documents

"What are the limitations mentioned?"
→ Explicit list with source citations
```

### Professional Fact-Checking

```
"Does the document support the claim that X?"
→ YES with quote, NO, or [NOT FOUND IN DOCUMENTS]

"What evidence is provided for Y?"
→ Listed evidence with source attribution

"Are there any contradictions between documents?"
→ Comparison analysis with specific citations
```

---

## Question Types

Claude automatically detects your question type and applies the appropriate structure:

### Comparison Questions
**Triggers**: "compare", "vs", "versus", "difference", "similarities"

```
"Compare approach A vs approach B in the documents"

Output structure:
- Elements being compared
- Similarities (with sources)
- Differences (with sources)
- Synthesis
```

### List Questions
**Triggers**: "list", "identify", "which", "what are the"

```
"List all the requirements mentioned"

Output structure:
1. Item - SOURCE: [document] - "quote"
2. Item - SOURCE: [document] - "quote"
...
```

### Analysis Questions
**Triggers**: "analyze", "examine", "evaluate", "assess"

```
"Analyze the risk factors discussed"

Output structure:
- Subject of analysis
- Observations (with evidence)
- Evidence (direct quotes)
- Conclusions (sourced)
```

### Explanation Questions
**Triggers**: "explain", "why", "how does"

```
"Explain how the process works according to the manual"

Output structure:
- Concept identified
- Explanation (sourced)
- Examples from documents
- Related information
```

### Extraction Questions
**Default for all other questions**

```
"What is the deadline mentioned?"

Output structure:
- Data point
- SOURCE: [document/section]
- QUOTE: "exact text"
```

---

## Language Support

The structured fork works with **any language Claude supports**.

**Tested**: Italian - works perfectly with Italian users and documents.

**How it works**:
1. Claude detects your language from context
2. Structuring instructions adapt to your language
3. NotebookLM responds in the same language
4. No configuration needed

**Other languages**: Should work automatically. If you use a language other than Italian, please share feedback on GitHub!

---

## Best Practices

### 1. Ask Specific Questions
More specific questions → better structured responses

```
❌ "Tell me about the project"
✅ "What are the project milestones and their deadlines?"
```

### 2. Trust the `[NOT FOUND]` Response
When you see `[NOT FOUND IN DOCUMENTS]`, it means:
- The information genuinely isn't in your documents
- Source fidelity is working correctly
- NotebookLM isn't making things up

### 3. Use Multiple Questions for Complex Topics
```
1. "What does document A say about X?"
2. "What does document B say about X?"
3. "Are there contradictions between the two?"
```

### 4. Session Management
- Same `session_id` maintains context across questions
- Sessions auto-cleanup after 15 minutes
- Use `reset_session` to start fresh

---

## Authentication

### Automatic Connection Verification

This fork automatically checks authentication before operations:

1. You ask a question
2. Server verifies NotebookLM connection
3. If expired/missing:
   - Chrome running → Message to close Chrome
   - Chrome closed → Auto-opens login browser
4. After login, original request proceeds

**No manual intervention needed** in most cases.

### Manual Authentication

```
"Check NotebookLM health"     → get_health
"Setup NotebookLM auth"       → setup_auth (opens browser)
"Switch NotebookLM account"   → re_auth (clears and re-authenticates)
```

### Rate Limits
- Free accounts: 50 queries/day
- Google AI Pro/Ultra: 5x higher limits
- Use `re_auth` to switch accounts when limit reached

---

## Notebook Management

### Add Notebooks
```
"Add this NotebookLM notebook: [URL]"
```

### Switch Notebooks
```
"Use the Legal Docs notebook"
"Switch to Research Papers notebook"
```

### Organize with Metadata
```
"Add notebook with description 'Contract analysis Q4 2024'
 and tags: legal, contracts, Q4"
```

---

## Example Workflow

### Legal Research Session

```
1. "Add the Case Law notebook: [URL]"
2. "What does Smith v. Jones say about negligence?"
   → Structured response with citations
3. "Compare that with the ruling in Brown v. Davis"
   → Comparison with sources from both cases
4. "Are there any contradictions?"
   → Analysis with specific page references
5. "Extract all mentions of 'duty of care'"
   → List with direct quotes and sources
```

### Research Literature Review

```
1. "Select the Literature Review notebook"
2. "What methodology did each study use?"
   → Structured list per study
3. "What are the main findings across all papers?"
   → Findings attributed to specific papers
4. "What limitations are mentioned?"
   → Source-faithful list
5. "Are there gaps in the research?"
   → Analysis based only on what papers state
```

---

## Troubleshooting

### NotebookLM Timeout
- Never use decorative lines (`===` or `---`) in custom prompts
- This fork handles this automatically

### Responses Include External Knowledge
- Verify you're using `ask_question` tool
- Check that structuring hasn't been accidentally disabled

### Missing Citations
- Ask more specific questions
- General questions may produce less structured responses

See [Troubleshooting Guide](troubleshooting.md) for more.

---

## Credits

- Original `notebooklm-mcp`: [Gérôme Dexheimer](https://github.com/PleasePrompto/notebooklm-mcp)
- Client-side structuring approach: Paolo Dalprato
