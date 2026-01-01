/**
 * Custom Error Types for NotebookLM MCP Server
 */

/**
 * Regex pattern to detect closed browser page/context errors
 * Used for automatic session recovery when browser context is unexpectedly closed
 */
export const PAGE_CLOSED_PATTERN = /has been closed|Target .* closed|Browser has been closed|Context .* closed/i;

/**
 * Helper function to check if an error indicates a closed page/context
 */
export function isPageClosedError(error: unknown): boolean {
  const message = String((error as Error)?.message || error);
  return PAGE_CLOSED_PATTERN.test(message);
}

/**
 * Error thrown when NotebookLM rate limit is exceeded
 *
 * Free users have 50 queries/day limit.
 * This error indicates the user should:
 * - Use re_auth tool to switch Google accounts
 * - Wait until tomorrow for quota reset
 * - Upgrade to Google AI Pro/Ultra for higher limits
 */
export class RateLimitError extends Error {
  constructor(message: string = "NotebookLM rate limit reached (50 queries/day for free accounts)") {
    super(message);
    this.name = "RateLimitError";

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RateLimitError);
    }
  }
}

/**
 * Error thrown when authentication fails
 *
 * This error can suggest cleanup workflow for persistent issues.
 * Especially useful when upgrading from old installation (notebooklm-mcp-nodejs).
 */
export class AuthenticationError extends Error {
  suggestCleanup: boolean;

  constructor(message: string, suggestCleanup: boolean = false) {
    super(message);
    this.name = "AuthenticationError";
    this.suggestCleanup = suggestCleanup;

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthenticationError);
    }
  }
}
