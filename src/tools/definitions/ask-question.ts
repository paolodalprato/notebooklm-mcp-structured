import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NotebookLibrary } from "../../library/notebook-library.js";

/**
 * Build dynamic tool description for ask_question based on active notebook or library
 */
export function buildAskQuestionDescription(library: NotebookLibrary): string {
  const active = library.getActiveNotebook();
  const bt = "`"; // Backtick helper to avoid template literal issues

  // Structuring guidelines for client-side prompt enhancement
  const structuringGuidelines = `

## 🎯 PROMPT STRUCTURING GUIDELINES (CRITICAL FOR SOURCE FIDELITY)

Before sending any question to NotebookLM, you MUST structure it to ensure responses come ONLY from uploaded documents.

**Why Structure?** Simple questions risk mixing document content with external knowledge. Structured prompts enforce source fidelity.

**How to Structure (adapt to user's language):**

${bt}${bt}${bt}
RESPONSE INSTRUCTIONS

TASK: [user's original question - keep in their language]

OPERATIONAL CONSTRAINTS
- Use ONLY information explicitly present in uploaded documents
- DO NOT add external knowledge, interpretations, or inferences
- If information is not present, declare it explicitly (e.g., "[NOT FOUND IN DOCUMENTS]")

REQUIRED OUTPUT FORMAT
[Adapt based on question type - see below]

CITATIONS
- Every claim MUST include source (document name or section)
- Use direct quotes where possible
- Citation format: "quoted text" [Source: document name]

HANDLING MISSING INFORMATION
- If requested information is not in documents, state it explicitly
- Never invent, infer, or complete with external knowledge
- An incomplete but accurate response is preferable to unreliable completeness

BEGIN STRUCTURED RESPONSE
${bt}${bt}${bt}

**CRITICAL FORMATTING RULES:**
- Translate these instructions to match the user's language for better NotebookLM understanding
- Do NOT use decorative lines (===, ---) as they cause NotebookLM timeouts
- Keep the user's original question wording intact

**Question Type Adaptation:**

1. **Comparison** (compare, vs, difference): Format as elements, similarities, differences, synthesis
2. **List** (list, identify, which): Format as numbered items with descriptions and sources
3. **Analysis** (analyze, examine, evaluate): Format as subject, observations, evidence, conclusions
4. **Explanation** (explain, why, how): Format as concept, answer, examples, related info
5. **Extraction** (default): Format as data points with quotes and sources

**Example - Italian User:**

User asks: "Analizza le sentenze presenti nei documenti"

You structure as:
${bt}${bt}${bt}
ISTRUZIONI PER LA RISPOSTA

COMPITO: Analizza le sentenze presenti nei documenti

VINCOLI OPERATIVI
- Usa ESCLUSIVAMENTE informazioni esplicite nei documenti caricati
- NON aggiungere conoscenze esterne, interpretazioni o inferenze
- Se un'informazione non è presente, dichiara: "[NON PRESENTE NEI DOCUMENTI]"

FORMATO OUTPUT RICHIESTO
Per ogni sentenza trovata:
- SENTENZA: [identificativo]
- OSSERVAZIONI: [analisi basata sui documenti]
- EVIDENZE: "citazioni dirette" [Fonte]

CITAZIONI
- Ogni affermazione DEVE includere la fonte
- Usa citazioni dirette tra virgolette dove possibile

GESTIONE INFORMAZIONI MANCANTI
- Se un'informazione non è nei documenti, dichiaralo esplicitamente

INIZIO RISPOSTA STRUTTURATA
${bt}${bt}${bt}

**Example - English User:**

User asks: "What are the main findings in the research papers?"

You structure as:
${bt}${bt}${bt}
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
${bt}${bt}${bt}

**Response Handling:**
After receiving NotebookLM's answer, present it faithfully to the user WITHOUT adding external knowledge or "improvements".
`;

  if (active) {
    const topics = active.topics.join(", ");
    const useCases = active.use_cases.map((uc) => `  - ${uc}`).join("\n");

    return `# Conversational Research Partner (NotebookLM • Gemini 2.5 • Session RAG)

**Active Notebook:** ${active.name}
**Content:** ${active.description}
**Topics:** ${topics}

> Auth tip: If login is required, use the prompt 'notebooklm.auth-setup' and then verify with the 'get_health' tool. If authentication later fails (e.g., expired cookies), use the prompt 'notebooklm.auth-repair'.

## What This Tool Is
- Full conversational research with Gemini (LLM) grounded on your notebook sources
- Session-based: each follow-up uses prior context for deeper, more precise answers
- Source-cited responses designed to minimize hallucinations

## When To Use
${useCases}

## Rules (Important)
- Always prefer continuing an existing session for the same task
- If you start a new thread, create a new session and keep its session_id
- Ask clarifying questions before implementing; do not guess missing details
- If multiple notebooks could apply, propose the top 1–2 and ask which to use
- If task context changes, ask to reset the session or switch notebooks
- If authentication fails, use the prompts 'notebooklm.auth-repair' (or 'notebooklm.auth-setup') and verify with 'get_health'
- After every NotebookLM answer: pause, compare with the user's goal, and only respond if you are 100% sure the information is complete. Otherwise, plan the next NotebookLM question in the same session.

## Session Flow (Recommended)
${bt}${bt}${bt}javascript
// 1) Start broad (no session_id → creates one)
ask_question({ question: "Give me an overview of [topic]" })
// ← Save: result.session_id

// 2) Go specific (same session)
ask_question({ question: "Key APIs/methods?", session_id })

// 3) Cover pitfalls (same session)
ask_question({ question: "Common edge cases + gotchas?", session_id })

// 4) Ask for production example (same session)
ask_question({ question: "Show a production-ready example", session_id })
${bt}${bt}${bt}

## Automatic Multi-Pass Strategy (Host-driven)
- Simple prompts return once-and-done answers.
- For complex prompts, the host should issue follow-up calls:
  1. Implementation plan (APIs, dependencies, configuration, authentication).
  2. Pitfalls, gaps, validation steps, missing prerequisites.
- Keep the same session_id for all follow-ups, review NotebookLM's answer, and ask more questions until the problem is fully resolved.
- Before replying to the user, double-check: do you truly have everything? If not, queue another ask_question immediately.

## 🔥 REAL EXAMPLE

Task: "Implement error handling in n8n workflow"

Bad (shallow):
${bt}${bt}${bt}
Q: "How do I handle errors in n8n?"
A: [basic answer]
→ Implement → Probably missing edge cases!
${bt}${bt}${bt}

Good (deep):
${bt}${bt}${bt}
Q1: "What are n8n's error handling mechanisms?" (session created)
A1: [Overview of error handling]

Q2: "What's the recommended pattern for API errors?" (same session)
A2: [Specific patterns, uses context from Q1]

Q3: "How do I handle retry logic and timeouts?" (same session)
A3: [Detailed approach, builds on Q1+Q2]

Q4: "Show me a production example with all these patterns" (same session)
A4: [Complete example with full context]

→ NOW implement with confidence!
${bt}${bt}${bt}
    
## Notebook Selection
- Default: active notebook (${active.id})
- Or set notebook_id to use a library notebook
- Or set notebook_url for ad-hoc notebooks (not in library)
- If ambiguous which notebook fits, ASK the user which to use

${structuringGuidelines}`;
  } else {
    return `# Conversational Research Partner (NotebookLM • Gemini 2.5 • Session RAG)

## No Active Notebook
- Visit https://notebooklm.google to create a notebook and get a share link
- Use **add_notebook** to add it to your library (explains how to get the link)
- Use **list_notebooks** to show available sources
- Use **select_notebook** to set one active

> Auth tip: If login is required, use the prompt 'notebooklm.auth-setup' and then verify with the 'get_health' tool. If authentication later fails (e.g., expired cookies), use the prompt 'notebooklm.auth-repair'.

Tip: Tell the user you can manage NotebookLM library and ask which notebook to use for the current task.

${structuringGuidelines}`;
  }
}

export const askQuestionTool: Tool = {
  name: "ask_question",
  // Description will be set dynamically using buildAskQuestionDescription
  description: "Dynamic description placeholder", 
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask NotebookLM",
      },
      session_id: {
        type: "string",
        description:
          "Optional session ID for contextual conversations. If omitted, a new session is created.",
      },
      notebook_id: {
        type: "string",
        description:
          "Optional notebook ID from your library. If omitted, uses the active notebook. " +
          "Use list_notebooks to see available notebooks.",
      },
      notebook_url: {
        type: "string",
        description:
          "Optional notebook URL (overrides notebook_id). Use this for ad-hoc queries to notebooks not in your library.",
      },
      show_browser: {
        type: "boolean",
        description:
          "Show browser window for debugging (simple version). " +
          "For advanced control (typing speed, stealth, etc.), use browser_options instead.",
      },
      browser_options: {
        type: "object",
        description:
          "Optional browser behavior settings. Claude can control everything: " +
          "visibility, typing speed, stealth mode, timeouts. Useful for debugging or fine-tuning.",
        properties: {
          show: {
            type: "boolean",
            description: "Show browser window (default: from ENV or false)",
          },
          headless: {
            type: "boolean",
            description: "Run browser in headless mode (default: true)",
          },
          timeout_ms: {
            type: "number",
            description: "Browser operation timeout in milliseconds (default: 30000)",
          },
          stealth: {
            type: "object",
            description: "Human-like behavior settings to avoid detection",
            properties: {
              enabled: {
                type: "boolean",
                description: "Master switch for all stealth features (default: true)",
              },
              random_delays: {
                type: "boolean",
                description: "Random delays between actions (default: true)",
              },
              human_typing: {
                type: "boolean",
                description: "Human-like typing patterns (default: true)",
              },
              mouse_movements: {
                type: "boolean",
                description: "Realistic mouse movements (default: true)",
              },
              typing_wpm_min: {
                type: "number",
                description: "Minimum typing speed in WPM (default: 160)",
              },
              typing_wpm_max: {
                type: "number",
                description: "Maximum typing speed in WPM (default: 240)",
              },
              delay_min_ms: {
                type: "number",
                description: "Minimum delay between actions in ms (default: 100)",
              },
              delay_max_ms: {
                type: "number",
                description: "Maximum delay between actions in ms (default: 400)",
              },
            },
          },
          viewport: {
            type: "object",
            description: "Browser viewport size",
            properties: {
              width: {
                type: "number",
                description: "Viewport width in pixels (default: 1920)",
              },
              height: {
                type: "number",
                description: "Viewport height in pixels (default: 1080)",
              },
            },
          },
        },
      },
    },
    required: ["question"],
  },
};
