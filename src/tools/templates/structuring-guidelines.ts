/**
 * Prompt Structuring Guidelines Template v2
 *
 * Task-oriented approach: each question type gets a specific prompt pattern
 * that focuses on output structure and cross-referencing.
 *
 * Design principles:
 * - No redundant constraints (NotebookLM already uses only uploaded documents)
 * - Positive instructions ("do X") instead of negative ("don't do Y")
 * - Type-specific prompt patterns instead of a rigid universal template
 * - Explicit cross-referencing to leverage NLM's multi-doc capabilities
 * - Completeness signal to push for exhaustive coverage
 * - Natural language prompting for better Gemini response quality
 */

/**
 * Build the structuring guidelines section for the ask_question tool description.
 *
 * @param bt - Backtick character (passed to avoid template literal issues)
 * @returns The structuring guidelines markdown string
 */
export function buildStructuringGuidelines(bt: string): string {
  return `

## PROMPT STRUCTURING GUIDELINES

Before sending any question to NotebookLM, structure it to get a well-organized, evidence-based response.

**Core rules:**
- Write the prompt in the user's language
- Keep the user's original question wording intact
- Never use decorative lines (===, ---) as they cause NotebookLM timeouts
- Always include: thematic output format, citation format, completeness signal, and the [NOT FOUND] placeholder

**How to structure:** Pick the matching question type below and adapt its pattern to the user's question.

### Question Type Patterns

**1. Comparison** (compare, vs, difference, similarities)

${bt}${bt}${bt}
[user's question]

Organize the response by points of comparison. Cover all aspects discussed in the documents.
For each point:
1. How each element addresses it, with direct quotes ("text" [Source: document])
2. Similarities and differences, with textual evidence

Cross-references: highlight where documents agree or contradict each other.
If information is not found: [NOT FOUND IN DOCUMENTS]
${bt}${bt}${bt}

**2. List / Identification** (list, identify, which, what are the)

${bt}${bt}${bt}
[user's question]

Organize the response by thematic topics. Cover all aspects discussed in the documents.
For each topic:
- TOPIC: [identifying title]
- DESCRIPTION: [synthesis with context, connecting information across documents]
- EVIDENCE: "direct quote" [Source: document]

If the same item appears in multiple documents, show all occurrences and any discrepancies.
If information is not found: [NOT FOUND IN DOCUMENTS]
${bt}${bt}${bt}

**3. Analysis** (analyze, examine, evaluate, assess)

${bt}${bt}${bt}
[user's question]

Organize the response by thematic topics. Cover all aspects discussed in the documents.
For each topic:
- TOPIC: [identifying title]
- DESCRIPTION: [synthesis with context, connecting information across documents]
- EVIDENCE: "direct quote" [Source: document]

Cross-document connections: where different documents address the same topic, show evidence from each.
If information is not found: [NOT FOUND IN DOCUMENTS]
${bt}${bt}${bt}

**4. Explanation** (explain, why, how, what does it mean)

${bt}${bt}${bt}
[user's question]

Answer based on what the documents explain. Cover all aspects discussed in the documents.
1. Core concept or answer, with supporting quotes ("text" [Source])
2. Examples or cases mentioned in the documents
3. Related concepts that the documents connect to this topic
4. Limitations or caveats noted in the documents

If information is not found: [NOT FOUND IN DOCUMENTS]
${bt}${bt}${bt}

**5. Extraction** (default for all other questions)

${bt}${bt}${bt}
[user's question]

Organize the response by thematic topics. Cover all aspects discussed in the documents.
For each topic:
- TOPIC: [identifying title]
- DESCRIPTION: [synthesis with context, connecting information across documents]
- EVIDENCE: "direct quote" [Source: document]

If a topic appears in multiple documents, show evidence from each.
If information is not found: [NOT FOUND IN DOCUMENTS]
${bt}${bt}${bt}

### Language Adaptation

Translate the entire prompt to the user's language. Examples:

- "Organize the response by thematic topics" → "Organizza la risposta per argomenti tematici"
- "Cover all aspects" → "Cerca di coprire tutti gli aspetti trattati nei documenti"
- "TOPIC/DESCRIPTION/EVIDENCE" → "ARGOMENTO/DESCRIZIONE/EVIDENZE"
- "Source:" → "Fonte:"
- "[NOT FOUND IN DOCUMENTS]" → "[NON PRESENTE NEI DOCUMENTI]"

### Response Handling (for Claude, not NotebookLM)
After receiving NotebookLM's answer, present it faithfully to the user WITHOUT adding external knowledge or "improvements".
`;
}
