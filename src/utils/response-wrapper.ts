/**
 * Response Wrapper for NotebookLM answers
 * 
 * Adds instructions to Claude to prevent it from adding external knowledge
 * when the user is working in "source-only" mode.
 * 
 * This addresses the second user requirement: Claude should not add
 * elements not present in the NotebookLM documents.
 */

export interface ResponseWrapperConfig {
  // Enable/disable response wrapping
  enabled: boolean;
  
  // Mode: "strict" = strong containment instructions, "balanced" = softer guidelines
  mode: "strict" | "balanced";
  
  // Language for instructions
  language: "en" | "it" | "auto";
}

export const DEFAULT_WRAPPER_CONFIG: ResponseWrapperConfig = {
  enabled: true,
  mode: "strict",
  language: "auto",
};

/**
 * Instructions to append to NotebookLM responses
 */
const CONTAINMENT_INSTRUCTIONS = {
  strict: {
    en: `

---
⚠️ SOURCE FIDELITY INSTRUCTIONS FOR CLAUDE:
This response comes from NotebookLM, which ONLY uses the uploaded documents.
DO NOT supplement, enhance, or add information from your training data.
DO NOT make assumptions or inferences beyond what is stated above.
If the user needs additional information not covered by the sources, say so explicitly rather than filling gaps with external knowledge.
Your role is to RELAY this information faithfully, not to augment it.
---`,
    it: `

---
⚠️ ISTRUZIONI DI FEDELTÀ ALLE FONTI PER CLAUDE:
Questa risposta proviene da NotebookLM, che usa SOLO i documenti caricati.
NON integrare, arricchire o aggiungere informazioni dai tuoi dati di addestramento.
NON fare assunzioni o inferenze oltre quanto dichiarato sopra.
Se l'utente ha bisogno di informazioni aggiuntive non coperte dalle fonti, dichiaralo esplicitamente invece di colmare le lacune con conoscenze esterne.
Il tuo ruolo è TRASMETTERE queste informazioni fedelmente, non aumentarle.
---`,
  },
  balanced: {
    en: `

---
Note: This response is grounded on the uploaded documents. If you need to add context, clearly distinguish between source-based information and your own additions.
---`,
    it: `

---
Nota: Questa risposta è basata sui documenti caricati. Se aggiungi contesto, distingui chiaramente tra informazioni dalle fonti e tue aggiunte.
---`,
  },
};

/**
 * Detect language from response text
 */
function detectLanguage(text: string): "en" | "it" {
  // Common Italian patterns
  const italianPatterns = [
    /\b(il|la|lo|gli|le|un|una|uno)\b/i,
    /\b(che|cosa|come|quando|dove|perché|quale)\b/i,
    /\b(sono|sei|è|siamo|siete)\b/i,
    /\b(questo|questa|questi|queste)\b/i,
    /\b(nel|nella|nei|nelle|sul|sulla)\b/i,
    /zione\b/i,
    /mente\b/i,
  ];

  let italianScore = 0;
  for (const pattern of italianPatterns) {
    if (pattern.test(text)) {
      italianScore++;
    }
  }

  return italianScore >= 3 ? "it" : "en";
}

/**
 * Wrap a NotebookLM response with containment instructions for Claude
 */
export function wrapResponse(
  response: string,
  config: Partial<ResponseWrapperConfig> = {}
): string {
  const fullConfig = { ...DEFAULT_WRAPPER_CONFIG, ...config };

  // If wrapping is disabled, return original response
  if (!fullConfig.enabled) {
    return response;
  }

  // Detect or use specified language
  const lang = fullConfig.language === "auto" 
    ? detectLanguage(response) 
    : fullConfig.language;

  // Get appropriate instructions
  const instructions = CONTAINMENT_INSTRUCTIONS[fullConfig.mode][lang];

  return `${response}${instructions}`;
}

/**
 * Parse wrapper config from environment variables
 */
export function parseWrapperConfigFromEnv(): Partial<ResponseWrapperConfig> {
  const config: Partial<ResponseWrapperConfig> = {};

  if (process.env.NOTEBOOKLM_WRAP_RESPONSES !== undefined) {
    config.enabled = process.env.NOTEBOOKLM_WRAP_RESPONSES.toLowerCase() === "true";
  }

  if (process.env.NOTEBOOKLM_WRAPPER_MODE !== undefined) {
    const mode = process.env.NOTEBOOKLM_WRAPPER_MODE.toLowerCase();
    if (mode === "strict" || mode === "balanced") {
      config.mode = mode;
    }
  }

  if (process.env.NOTEBOOKLM_WRAPPER_LANGUAGE !== undefined) {
    const lang = process.env.NOTEBOOKLM_WRAPPER_LANGUAGE.toLowerCase();
    if (lang === "en" || lang === "it" || lang === "auto") {
      config.language = lang;
    }
  }

  return config;
}
