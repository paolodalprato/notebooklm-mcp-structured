/**
 * Prompt Structuring Guidelines Template
 *
 * These guidelines instruct Claude on how to structure prompts for NotebookLM
 * to ensure responses come ONLY from uploaded documents (source fidelity).
 *
 * Extracted from ask-question.ts for maintainability.
 */

/**
 * Build the structuring guidelines section for the ask_question tool description.
 *
 * @param bt - Backtick character (passed to avoid template literal issues)
 * @returns The structuring guidelines markdown string
 */
export function buildStructuringGuidelines(bt: string): string {
  return `

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
}
