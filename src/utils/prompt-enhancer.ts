/**
 * Prompt Enhancer for NotebookLM queries
 * 
 * Transforms simple questions into STRUCTURED prompts that:
 * 1. Define explicit task, scope, and constraints
 * 2. Specify output format and structure
 * 3. Require citations and source attribution
 * 4. Declare handling of missing information
 * 
 * This ensures maximum fidelity to source documents and 
 * produces well-organized, extractable responses.
 */

export interface PromptEnhancerConfig {
  // Enable/disable prompt enhancement
  enabled: boolean;
  
  // Request explicit citations from sources
  requireCitations: boolean;
  
  // Require declaration when info not found
  requireNotFoundDeclaration: boolean;
  
  // Language for instructions (affects prompt structure)
  language: "en" | "it" | "auto";
  
  // Mode: "strict" = maximum source fidelity, "balanced" = allow some synthesis
  mode: "strict" | "balanced";
  
  // Output format preference
  outputFormat: "structured" | "narrative" | "auto";
}

export const DEFAULT_ENHANCER_CONFIG: PromptEnhancerConfig = {
  enabled: true,
  requireCitations: true,
  requireNotFoundDeclaration: true,
  language: "auto",
  mode: "strict",
  outputFormat: "structured",
};

/**
 * Analyze question to determine optimal output structure
 */
function analyzeQuestionType(question: string): {
  type: "extraction" | "analysis" | "comparison" | "list" | "explanation";
  suggestedSections: string[];
} {
  const lowerQ = question.toLowerCase();
  
  // Comparison questions
  if (lowerQ.includes("confronta") || lowerQ.includes("compare") || 
      lowerQ.includes("differenz") || lowerQ.includes("differ") ||
      lowerQ.includes("vs") || lowerQ.includes("versus")) {
    return {
      type: "comparison",
      suggestedSections: ["elementi_confrontati", "similitudini", "differenze", "sintesi"]
    };
  }
  
  // List/enumeration questions
  if (lowerQ.includes("elenca") || lowerQ.includes("list") ||
      lowerQ.includes("quali sono") || lowerQ.includes("what are") ||
      lowerQ.includes("identifica") || lowerQ.includes("identify")) {
    return {
      type: "list",
      suggestedSections: ["elementi_trovati", "dettagli_per_elemento", "fonte"]
    };
  }
  
  // Analysis questions
  if (lowerQ.includes("analizza") || lowerQ.includes("analyze") ||
      lowerQ.includes("esamina") || lowerQ.includes("examine") ||
      lowerQ.includes("valuta") || lowerQ.includes("evaluate")) {
    return {
      type: "analysis",
      suggestedSections: ["oggetto_analisi", "osservazioni", "evidenze", "conclusioni"]
    };
  }
  
  // Explanation questions
  if (lowerQ.includes("spiega") || lowerQ.includes("explain") ||
      lowerQ.includes("perché") || lowerQ.includes("why") ||
      lowerQ.includes("come") || lowerQ.includes("how")) {
    return {
      type: "explanation",
      suggestedSections: ["concetto", "spiegazione", "esempi", "fonte"]
    };
  }
  
  // Default: extraction
  return {
    type: "extraction",
    suggestedSections: ["dati_estratti", "citazioni", "fonte"]
  };
}

/**
 * Build structured prompt - Italian version
 */
function buildStructuredPromptIT(
  question: string, 
  mode: "strict" | "balanced",
  questionType: ReturnType<typeof analyzeQuestionType>
): string {
  const modeInstructions = mode === "strict" 
    ? `- Usa ESCLUSIVAMENTE informazioni esplicite nei documenti caricati
- NON aggiungere conoscenze esterne, interpretazioni o inferenze
- Se un'informazione non è presente, dichiara: "[NON PRESENTE NEI DOCUMENTI]"`
    : `- Basa la risposta principalmente sui documenti caricati
- Se sintetizzi da più fonti, indica chiaramente quali
- Distingui tra dati documentali e tue elaborazioni`;

  const formatInstructions = getFormatInstructionsIT(questionType);

  return `ISTRUZIONI PER LA RISPOSTA

COMPITO: ${question}

VINCOLI OPERATIVI
${modeInstructions}

FORMATO OUTPUT RICHIESTO
${formatInstructions}

CITAZIONI
- Ogni affermazione DEVE includere la fonte (nome documento o sezione)
- Usa citazioni dirette tra virgolette dove possibile
- Formato citazione: "testo citato" [Fonte: nome documento]

GESTIONE INFORMAZIONI MANCANTI
- Se l'informazione richiesta non è nei documenti, dichiaralo esplicitamente
- Non inventare, non inferire, non completare con conoscenze esterne
- È preferibile una risposta incompleta ma accurata a una completa ma inaffidabile

INIZIO RISPOSTA STRUTTURATA`;
}

/**
 * Build structured prompt - English version
 */
function buildStructuredPromptEN(
  question: string, 
  mode: "strict" | "balanced",
  questionType: ReturnType<typeof analyzeQuestionType>
): string {
  const modeInstructions = mode === "strict" 
    ? `- Use ONLY information explicitly present in uploaded documents
- DO NOT add external knowledge, interpretations or inferences
- If information is not present, state: "[NOT FOUND IN DOCUMENTS]"`
    : `- Base your response primarily on uploaded documents
- If synthesizing from multiple sources, clearly indicate which ones
- Distinguish between documented data and your elaborations`;

  const formatInstructions = getFormatInstructionsEN(questionType);

  return `RESPONSE INSTRUCTIONS

TASK: ${question}

OPERATIONAL CONSTRAINTS
${modeInstructions}

REQUIRED OUTPUT FORMAT
${formatInstructions}

CITATIONS
- Every claim MUST include source (document name or section)
- Use direct quotes where possible
- Citation format: "quoted text" [Source: document name]

HANDLING MISSING INFORMATION
- If requested information is not in documents, state it explicitly
- Do not invent, infer, or complete with external knowledge
- An incomplete but accurate response is preferable to a complete but unreliable one

BEGIN STRUCTURED RESPONSE`;
}

/**
 * Get format instructions based on question type - Italian
 */
function getFormatInstructionsIT(
  questionType: ReturnType<typeof analyzeQuestionType>
): string {
  switch (questionType.type) {
    case "comparison":
      return `Struttura la risposta come segue:

1. ELEMENTI CONFRONTATI
   - Elemento A: [nome/descrizione]
   - Elemento B: [nome/descrizione]

2. SIMILITUDINI
   Per ogni similitudine:
   - Aspetto: [descrizione]
   - Evidenza A: "citazione" [Fonte]
   - Evidenza B: "citazione" [Fonte]

3. DIFFERENZE
   Per ogni differenza:
   - Aspetto: [descrizione]
   - Posizione A: "citazione" [Fonte]
   - Posizione B: "citazione" [Fonte]

4. SINTESI
   - Conclusioni basate solo sulle evidenze sopra`;

    case "list":
      return `Struttura la risposta come lista:

Per ogni elemento trovato:
- ELEMENTO: [nome/titolo]
- DESCRIZIONE: [dettagli dal documento]
- CITAZIONE: "testo rilevante" [Fonte: documento]

Se richiesto un conteggio, fornisci il numero totale.`;

    case "analysis":
      return `Struttura l'analisi come segue:

1. OGGETTO DELL'ANALISI
   - Cosa viene analizzato
   - Perimetro dei documenti esaminati

2. OSSERVAZIONI
   Per ogni osservazione:
   - Punto: [descrizione]
   - Evidenza: "citazione" [Fonte]

3. PATTERN/TEMI RICORRENTI (se applicabile)
   - Pattern identificato
   - Occorrenze con citazioni

4. CONCLUSIONI
   - Solo conclusioni supportate dalle evidenze sopra`;

    case "explanation":
      return `Struttura la spiegazione come segue:

1. CONCETTO/DOMANDA
   - Riformulazione della domanda

2. RISPOSTA DAI DOCUMENTI
   - Spiegazione basata sulle fonti
   - Citazioni a supporto

3. ESEMPI (se presenti nei documenti)
   - Esempio: [descrizione]
   - Fonte: [documento]

4. INFORMAZIONI CORRELATE
   - Altri elementi rilevanti trovati`;

    default: // extraction
      return `Struttura l'estrazione come segue:

DATI ESTRATTI:
Per ogni dato rilevante:
- Dato: [informazione]
- Citazione: "testo originale"
- Fonte: [documento/sezione]

Se i dati sono multipli, organizzali per categoria o documento.`;
  }
}

/**
 * Get format instructions based on question type - English
 */
function getFormatInstructionsEN(
  questionType: ReturnType<typeof analyzeQuestionType>
): string {
  switch (questionType.type) {
    case "comparison":
      return `Structure response as follows:

1. ELEMENTS COMPARED
   - Element A: [name/description]
   - Element B: [name/description]

2. SIMILARITIES
   For each similarity:
   - Aspect: [description]
   - Evidence A: "quote" [Source]
   - Evidence B: "quote" [Source]

3. DIFFERENCES
   For each difference:
   - Aspect: [description]
   - Position A: "quote" [Source]
   - Position B: "quote" [Source]

4. SYNTHESIS
   - Conclusions based only on evidence above`;

    case "list":
      return `Structure response as list:

For each element found:
- ELEMENT: [name/title]
- DESCRIPTION: [details from document]
- QUOTE: "relevant text" [Source: document]

If count requested, provide total number.`;

    case "analysis":
      return `Structure analysis as follows:

1. ANALYSIS SUBJECT
   - What is being analyzed
   - Scope of documents examined

2. OBSERVATIONS
   For each observation:
   - Point: [description]
   - Evidence: "quote" [Source]

3. PATTERNS/RECURRING THEMES (if applicable)
   - Pattern identified
   - Occurrences with quotes

4. CONCLUSIONS
   - Only conclusions supported by evidence above`;

    case "explanation":
      return `Structure explanation as follows:

1. CONCEPT/QUESTION
   - Question restatement

2. ANSWER FROM DOCUMENTS
   - Explanation based on sources
   - Supporting quotes

3. EXAMPLES (if present in documents)
   - Example: [description]
   - Source: [document]

4. RELATED INFORMATION
   - Other relevant elements found`;

    default: // extraction
      return `Structure extraction as follows:

EXTRACTED DATA:
For each relevant data point:
- Data: [information]
- Quote: "original text"
- Source: [document/section]

If multiple data points, organize by category or document.`;
  }
}

/**
 * Detect language from question text
 */
function detectLanguage(question: string): "en" | "it" {
  const italianPatterns = [
    /\b(il|la|lo|gli|le|un|una|uno)\b/i,
    /\b(che|cosa|come|quando|dove|perché|quale)\b/i,
    /\b(sono|sei|è|siamo|siete)\b/i,
    /\b(ho|hai|ha|abbiamo|avete|hanno)\b/i,
    /\b(questo|questa|questi|queste)\b/i,
    /\b(nel|nella|nei|nelle|sul|sulla)\b/i,
    /\b(può|posso|puoi|potrebbe)\b/i,
    /\b(analizza|elenca|confronta|spiega|identifica)\b/i,
    /zione\b/i,
    /mente\b/i,
  ];

  let italianScore = 0;
  for (const pattern of italianPatterns) {
    if (pattern.test(question)) {
      italianScore++;
    }
  }

  return italianScore >= 2 ? "it" : "en";
}

/**
 * Enhance a simple question into a structured prompt for NotebookLM
 */
export function enhancePrompt(
  question: string,
  config: Partial<PromptEnhancerConfig> = {}
): string {
  const fullConfig = { ...DEFAULT_ENHANCER_CONFIG, ...config };

  // If enhancement is disabled, return original question
  if (!fullConfig.enabled) {
    return question;
  }

  // Detect or use specified language
  const lang = fullConfig.language === "auto" 
    ? detectLanguage(question) 
    : fullConfig.language;

  // Analyze question type for appropriate structure
  const questionType = analyzeQuestionType(question);

  // Build structured prompt
  if (lang === "it") {
    return buildStructuredPromptIT(question, fullConfig.mode, questionType);
  } else {
    return buildStructuredPromptEN(question, fullConfig.mode, questionType);
  }
}

/**
 * Parse the enhancer config from environment variables
 */
export function parseEnhancerConfigFromEnv(): Partial<PromptEnhancerConfig> {
  const config: Partial<PromptEnhancerConfig> = {};

  if (process.env.NOTEBOOKLM_ENHANCE_PROMPTS !== undefined) {
    config.enabled = process.env.NOTEBOOKLM_ENHANCE_PROMPTS.toLowerCase() === "true";
  }

  if (process.env.NOTEBOOKLM_REQUIRE_CITATIONS !== undefined) {
    config.requireCitations = process.env.NOTEBOOKLM_REQUIRE_CITATIONS.toLowerCase() === "true";
  }

  if (process.env.NOTEBOOKLM_PROMPT_MODE !== undefined) {
    const mode = process.env.NOTEBOOKLM_PROMPT_MODE.toLowerCase();
    if (mode === "strict" || mode === "balanced") {
      config.mode = mode;
    }
  }

  if (process.env.NOTEBOOKLM_PROMPT_LANGUAGE !== undefined) {
    const lang = process.env.NOTEBOOKLM_PROMPT_LANGUAGE.toLowerCase();
    if (lang === "en" || lang === "it" || lang === "auto") {
      config.language = lang;
    }
  }

  if (process.env.NOTEBOOKLM_OUTPUT_FORMAT !== undefined) {
    const format = process.env.NOTEBOOKLM_OUTPUT_FORMAT.toLowerCase();
    if (format === "structured" || format === "narrative" || format === "auto") {
      config.outputFormat = format;
    }
  }

  return config;
}
