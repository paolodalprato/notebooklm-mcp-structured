/**
 * DOM Selectors for NotebookLM UI
 *
 * Centralizing all selectors makes it easier to update when NotebookLM changes its UI.
 * If NotebookLM updates break the MCP, check these selectors first.
 *
 * Last verified: 2026-08 (Gemini Notebook UI, after the NotebookLM rename)
 */

// ============================================================================
// Chat Input Selectors
// ============================================================================

/**
 * Primary selector for the chat input textarea
 */
export const CHAT_INPUT_PRIMARY = "textarea.query-box-input";

/**
 * Fallback selector using aria-label (English UI)
 */
export const CHAT_INPUT_FALLBACK = 'textarea[aria-label="Enter a query"]';

/**
 * All chat input selectors in order of preference
 */
export const CHAT_INPUT_SELECTORS = [
  CHAT_INPUT_PRIMARY,
  CHAT_INPUT_FALLBACK,
] as const;

// ============================================================================
// Response Container Selectors
// ============================================================================

/**
 * Primary selector for assistant response containers
 */
export const RESPONSE_CONTAINER_PRIMARY = ".to-user-container";

/**
 * Selector for response text content within a container
 */
export const RESPONSE_TEXT_CONTENT = ".message-text-content";

/**
 * Gemini's reasoning block ("Thoughts").
 *
 * It lives INSIDE the response container, as a sibling of the answer blocks,
 * and it stays there after generation ends. Two consequences:
 * - while generating, it is the ONLY content of the container, so its text
 *   must never be mistaken for the answer;
 * - once done, it must be stripped from the captured text, because it is
 *   Gemini's reasoning, not the grounded response.
 */
export const THOUGHTS_ELEMENT = "thinking-chain-view";

/**
 * Action buttons (copy, rate) attached to a finished answer.
 *
 * Measured on 2026-08-13: they appear in the response container at the exact
 * moment generation ends, while the answer is streaming they are absent.
 * That makes them the completion signal. The send button also flips from
 * "stop generating" back to "send" at the same instant, but its label is
 * translated, so it cannot be matched reliably across languages.
 */
export const RESPONSE_COMPLETE_MARKER = ".message-actions";

/**
 * Fallback selectors for finding assistant responses
 * Ordered by specificity (most specific first)
 */
export const RESPONSE_SELECTORS = [
  ".to-user-container .message-text-content",
  "[data-message-author='bot']",
  "[data-message-author='assistant']",
  "[data-message-role='assistant']",
  "[data-author='assistant']",
  "[data-renderer*='assistant']",
  "[data-automation-id='response-text']",
  "[data-automation-id='assistant-response']",
  "[data-automation-id='chat-response']",
  "[data-testid*='assistant']",
  "[data-testid*='response']",
  "[aria-live='polite']",
  "[role='listitem'][data-message-author]",
] as const;

// ============================================================================
// Error Detection Selectors
// ============================================================================

/**
 * Selectors for error message containers
 */
export const ERROR_SELECTORS = [
  ".error-message",
  ".error-container",
  "[role='alert']",
  ".rate-limit-message",
  "[data-error]",
  ".notification-error",
  ".alert-error",
  ".toast-error",
] as const;

/**
 * Keywords that indicate rate limiting (case-insensitive)
 */
export const RATE_LIMIT_KEYWORDS = [
  "rate limit",
  "limit exceeded",
  "quota exhausted",
  "daily limit",
  "limit reached",
  "too many requests",
  "quota",
  "query limit",
  "request limit",
] as const;

// ============================================================================
// JavaScript Evaluation Selectors
// ============================================================================

/**
 * Selectors used in page.evaluate() for fallback response extraction
 */
export const JS_EVAL_SELECTORS = [
  "[data-message-author]",
  "[data-message-role]",
  "[data-author]",
  "[data-renderer*='assistant']",
  "[data-testid*='assistant']",
  "[data-automation-id*='response']",
] as const;

/**
 * Selector for finding closest container in evaluate()
 */
export const JS_CONTAINER_SELECTOR =
  "[data-message-author], [data-message-role], [data-author], " +
  "[data-testid*='assistant'], [data-automation-id*='response'], article, section";
