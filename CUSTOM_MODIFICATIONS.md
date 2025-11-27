# Custom Modifications

This document details the custom modifications made to the original [notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp) project.

## Overview

**notebooklm-mcp-structured** is a fork that adds two critical features for professional use cases where document fidelity and source accuracy are paramount (legal analysis, research, fact-checking, compliance reviews).

## Key Modifications

### 1. Structured Prompt Enhancement (`src/utils/prompt-enhancer.ts`)

**Purpose**: Transform simple user questions into well-engineered prompts that enforce explicit constraints and citation requirements.

**Implementation**:
- **Question Type Detection**: Automatically categorizes questions into types:
  - `comparison` - Triggered by: "compare", "vs", "versus", "difference", "differenza"
  - `list` - Triggered by: "list", "elenca", "which", "quali", "identify", "identifica"
  - `analysis` - Triggered by: "analyze", "analizza", "examine", "esamina", "evaluate"
  - `explanation` - Triggered by: "explain", "spiega", "why", "perché", "how", "come"
  - `extraction` - Default fallback for data extraction

- **Template System**: Each question type has a structured template that includes:
  - **COMPITO** (Task): Clear statement of what needs to be done
  - **VINCOLI OPERATIVI** (Operational Constraints):
    - Use ONLY explicit information from loaded documents
    - NO external knowledge, interpretations, or inferences
    - Explicit declaration when information is missing: `[NON PRESENTE NEI DOCUMENTI]`
  - **FORMATO OUTPUT RICHIESTO** (Required Output Format):
    - Type-specific structure (e.g., comparison table, numbered list, analysis sections)
  - **CITAZIONI** (Citations):
    - Mandatory source attribution for every statement
    - Direct quotes where possible
    - Page/section references

- **Multi-language Support**:
  - Auto-detection based on question keywords
  - Italian (`it`) and English (`en`) templates
  - Override via `prompt_language` parameter

- **Modes**:
  - `strict`: Absolute prohibition of external knowledge
  - `balanced`: Allows synthesis but requires clear labeling

**Configuration**:
```typescript
{
  enhance_prompt: boolean,      // Enable/disable enhancement
  prompt_mode: 'strict' | 'balanced',
  prompt_language: 'en' | 'it' | 'auto'
}
```

**Example Transformation**:

Before (simple question):
```
Analizza le sentenze presenti nei documenti
```

After (structured prompt - NO decorative lines):
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
- Ogni affermazione DEVE includere la fonte (nome documento o sezione)
- Usa citazioni dirette tra virgolette dove possibile
- Formato citazione: "testo citato" [Fonte: nome documento]

GESTIONE INFORMAZIONI MANCANTI
- Se l'informazione richiesta non è nei documenti, dichiaralo esplicitamente
- Non inventare, non inferire, non completare con conoscenze esterne

INIZIO RISPOSTA STRUTTURATA
```

**IMPORTANT**: The prompt format uses plain text headers WITHOUT decorative lines (no `===` or `---`). This prevents NotebookLM from interpreting the prompt as invalid formatting and timing out.

### 2. Response Wrapper (`src/utils/response-wrapper.ts`)

**Purpose**: Add containment instructions to NotebookLM responses to prevent Claude from "enriching" them with external knowledge.

**Implementation**:
- **Wrapper Header**: Prepended to every NotebookLM response with clear instructions
- **Modes**:
  - `strict`: Absolute prohibition of external additions
  - `balanced`: Allows synthesis with clear labeling
- **Multi-language Support**: English and Italian wrapper templates

**Configuration**:
```typescript
{
  wrap_response: boolean,       // Enable/disable wrapping
  wrapper_mode: 'strict' | 'balanced'
}
```

### 3. Integration Layer (`src/tools/index.ts` modifications)

**Changes to `ask_question` tool**:
- Added parameters:
  - `enhance_prompt`: boolean (optional, defaults to env var)
  - `prompt_mode`: "strict" | "balanced" (optional)
  - `prompt_language`: "en" | "it" | "auto" (optional)
  - `wrap_response`: boolean (optional, defaults to env var)
  - `wrapper_mode`: "strict" | "balanced" (optional)

- **Processing Pipeline**:
  1. Read configuration from environment variables
  2. Override with per-call parameters if provided
  3. Apply prompt enhancement (if enabled)
  4. Send enhanced prompt to NotebookLM
  5. Receive response from NotebookLM
  6. Apply response wrapper (if enabled)
  7. Return wrapped response to Claude

**Environment Variables**:
```bash
NOTEBOOKLM_ENHANCE_PROMPTS=true
NOTEBOOKLM_PROMPT_MODE=strict
NOTEBOOKLM_PROMPT_LANGUAGE=auto
NOTEBOOKLM_WRAP_RESPONSES=true
NOTEBOOKLM_WRAPPER_MODE=strict
```

## File Structure

```
src/
├── utils/
│   ├── prompt-enhancer.ts      # NEW: Structured prompt generation
│   └── response-wrapper.ts     # NEW: Response containment system
├── tools/
│   └── index.ts               # MODIFIED: Integration of enhancer + wrapper
└── [other files unchanged]
```

## Use Case Examples

### Legal Document Analysis
**Before**:
```
User: "Analizza le sentenze"
→ NotebookLM receives simple question
→ Claude might add legal context from training data
```

**After**:
```
User: "Analizza le sentenze"
→ Enhanced to structured prompt with analysis template
→ NotebookLM receives explicit constraints
→ Response wrapped with containment instructions
→ Claude uses ONLY document-provided information
```

### Research Fact-Checking
**Before**:
```
User: "What does the study say about climate change?"
→ Risk of mixing study content with general knowledge
```

**After**:
```
User: "What does the study say about climate change?"
→ Enhanced prompt requires explicit citations
→ Missing information flagged as [NOT IN DOCUMENTS]
→ Response wrapped to prevent external enrichment
```

## Technical Design Decisions

### Why Two-Layer Approach (Enhancer + Wrapper)?

1. **Prompt Enhancement**: Ensures NotebookLM extracts information correctly
2. **Response Wrapper**: Ensures Claude respects the extracted information

Both layers are needed because:
- NotebookLM (Gemini) needs clear instructions for optimal extraction
- Claude needs explicit instructions NOT to add external knowledge

### Why No Decorative Lines?

NotebookLM interprets lines of `=` or `-` characters as invalid formatting, which causes the system to timeout. The structured prompts use plain text section headers instead.

### Why Per-Call Parameter Override?

Different queries need different strictness levels:
- **Legal/Compliance**: Always `strict` mode
- **Research Exploration**: Sometimes `balanced` mode for synthesis
- **Quick Lookups**: Might disable enhancement for simple queries

### Why Multi-language Support?

NotebookLM works better when instructions match document language:
- Italian legal documents → Italian prompts
- English research papers → English prompts
- Auto-detection handles mixed contexts

## Testing

The modifications maintain full backward compatibility:
- Default behavior (all features disabled) = original notebooklm-mcp
- Enable features via environment variables or per-call parameters

## Maintenance Notes

### Adding New Languages

1. Add templates in `src/utils/prompt-enhancer.ts`:
   ```typescript
   const buildStructuredPromptFR = () => { ... }  // French
   ```

2. Add wrapper templates in `src/utils/response-wrapper.ts`

3. Update language detection logic

### Adding New Question Types

1. Add detection keywords in `analyzeQuestionType()`
2. Create template in `getFormatInstructions[EN/IT]()`
3. Document in README.md

## Credits

- **Original Architecture**: [Gérôme Dexheimer](https://github.com/PleasePrompto/notebooklm-mcp)
- **Structured Prompts & Source Fidelity Enhancements**: Paolo Dalprato

## License

Maintains MIT License from original project.
