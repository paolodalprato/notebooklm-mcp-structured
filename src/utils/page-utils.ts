/**
 * Page utilities for extracting responses from NotebookLM web UI
 *
 * This module provides functions to:
 * - Extract latest assistant responses from the page
 * - Wait for new responses with streaming detection
 * - Detect placeholders and loading states
 * - Snapshot existing responses for comparison
 *
 * Based on the Python implementation from page_utils.py
 */

import type { Page } from "patchright";
import { CONFIG } from "../config.js";
import {
  RESPONSE_CONTAINER_PRIMARY,
  RESPONSE_TEXT_CONTENT,
  RESPONSE_SELECTORS,
  THINKING_INDICATOR,
  JS_EVAL_SELECTORS,
  JS_CONTAINER_SELECTOR,
} from "../selectors.js";
import { log } from "./logger.js";


// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Simple 32-bit string hash function (djb2 variant) for efficient comparison.
 *
 * Used to quickly identify already-seen response texts without storing
 * the full text content. This is a performance optimization for the
 * polling loop in waitForLatestAnswer().
 *
 * LIMITATIONS:
 * - 32-bit hash means possible collisions (~1 in 4 billion)
 * - For very long texts with similar prefixes, collision risk increases
 * - Not cryptographically secure - DO NOT use for security purposes
 *
 * For the current use case (comparing ~10-50 response texts per session),
 * collision probability is negligible (<0.00001%).
 *
 * @param str - The string to hash
 * @returns 32-bit integer hash
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}


// ============================================================================
// Main Functions
// ============================================================================

/**
 * Snapshot the latest response text currently visible
 * Returns null if no response found
 */
export async function snapshotLatestResponse(page: Page): Promise<string | null> {
  return await extractLatestText(page, new Set(), false, 0);
}

/**
 * Snapshot ALL existing assistant response texts
 * Used to capture visible responses BEFORE submitting a new question
 */
export async function snapshotAllResponses(page: Page): Promise<string[]> {
  const allTexts: string[] = [];

  try {
    const containers = await page.$$(RESPONSE_CONTAINER_PRIMARY);
    if (containers.length > 0) {
      for (const container of containers) {
        try {
          const textElement = await container.$(RESPONSE_TEXT_CONTENT);
          if (textElement) {
            const text = await textElement.innerText();
            if (text && text.trim()) {
              allTexts.push(text.trim());
            }
          }
        } catch {
          continue;
        }
      }

      log.info(`📸 [SNAPSHOT] Captured ${allTexts.length} existing responses`);
    }
  } catch (error) {
    log.warning(`⚠️ [SNAPSHOT] Failed to snapshot responses: ${error}`);
  }

  return allTexts;
}

/**
 * Count the number of visible assistant response elements
 */
export async function countResponseElements(page: Page): Promise<number> {
  let count = 0;
  for (const selector of RESPONSE_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      if (elements.length > 0) {
        // Count only visible elements
        for (const el of elements) {
          try {
            const isVisible = await el.isVisible();
            if (isVisible) {
              count++;
            }
          } catch {
            continue;
          }
        }
        // If we found elements with this selector, stop trying others
        if (count > 0) {
          break;
        }
      }
    } catch {
      continue;
    }
  }
  return count;
}

/**
 * Wait for a new assistant response with streaming detection
 *
 * This function:
 * 1. Polls the page for new response text
 * 2. Detects streaming (text changes) vs. complete (text stable)
 * 3. Requires text to be stable for 3 consecutive polls before returning
 * 4. Ignores placeholders, question echoes, and known responses
 *
 * @param page Playwright page instance
 * @param options Options for waiting
 * @returns The new response text, or null if timeout
 */
export async function waitForLatestAnswer(
  page: Page,
  options: {
    question?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    ignoreTexts?: string[];
    debug?: boolean;
  } = {}
): Promise<string | null> {
  const {
    question = "",
    timeoutMs = 120000,
    pollIntervalMs = 1000,
    ignoreTexts = [],
    debug = false,
  } = options;

  const deadline = Date.now() + timeoutMs;
  const sanitizedQuestion = question.trim().toLowerCase();

  // Track ALL known texts as HASHES (memory efficient!)
  const knownHashes = new Set<number>();
  for (const text of ignoreTexts) {
    if (typeof text === "string" && text.trim()) {
      knownHashes.add(hashString(text.trim()));
    }
  }

  if (debug) {
    log.debug(
      `🔍 [DEBUG] Waiting for NEW answer. Ignoring ${knownHashes.size} known responses`
    );
  }

  let pollCount = 0;
  let lastCandidate: string | null = null;
  let stableCount = 0; // Track how many times we see the same text
  const requiredStablePolls = CONFIG.requiredStablePolls;

  while (Date.now() < deadline) {
    pollCount++;

    // Check if NotebookLM is still "thinking" (most reliable indicator)
    try {
      const thinkingElement = await page.$(THINKING_INDICATOR);
      if (thinkingElement) {
        const isVisible = await thinkingElement.isVisible();
        if (isVisible) {
          if (debug && pollCount % 5 === 0) {
            log.debug("🔍 [DEBUG] NotebookLM still thinking (div.thinking-message visible)...");
          }
          await page.waitForTimeout(pollIntervalMs);
          continue;
        }
      }
    } catch {
      // Ignore errors checking thinking state
    }

    // Extract latest NEW text
    const candidate = await extractLatestText(
      page,
      knownHashes,
      debug,
      pollCount
    );

    if (candidate) {
      const normalized = candidate.trim();
      if (normalized) {
        const lower = normalized.toLowerCase();

        // Check if it's the question echo
        if (lower === sanitizedQuestion) {
          if (debug) {
            log.debug("🔍 [DEBUG] Found question echo, ignoring");
          }
          knownHashes.add(hashString(normalized)); // Mark as seen
          await page.waitForTimeout(pollIntervalMs);
          continue;
        }

        // ========================================
        // STREAMING DETECTION: Check if text is stable
        // ========================================
        if (normalized === lastCandidate) {
          // Text hasn't changed - it's stable
          stableCount++;
          if (debug && stableCount === requiredStablePolls) {
            log.debug(
              `✅ [DEBUG] Text stable for ${stableCount} polls (${normalized.length} chars)`
            );
          }
        } else {
          // Text changed - streaming in progress
          if (debug && lastCandidate) {
            log.debug(
              `🔄 [DEBUG] Text changed (${normalized.length} chars, was ${lastCandidate.length})`
            );
          }
          stableCount = 1;
          lastCandidate = normalized;
        }

        // Only return once text is stable
        if (stableCount >= requiredStablePolls) {
          if (debug) {
            log.debug(`✅ [DEBUG] Returning stable answer (${normalized.length} chars)`);
          }
          return normalized;
        }
      }
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  if (debug) {
    log.debug(`⏱️ [DEBUG] Timeout after ${pollCount} polls`);
  }
  return null;
}

/**
 * Extract the latest NEW response text from the page
 * Uses hash-based comparison for efficiency
 *
 * @param page Playwright page instance
 * @param knownHashes Set of hashes of already-seen response texts
 * @param debug Enable debug logging
 * @param pollCount Current poll number (for conditional logging)
 * @returns First NEW response text found, or null
 */
async function extractLatestText(
  page: Page,
  knownHashes: Set<number>,
  debug: boolean,
  pollCount: number
): Promise<string | null> {
  // Try the primary selector first (most specific for NotebookLM)
  try {
    const containers = await page.$$(RESPONSE_CONTAINER_PRIMARY);
    const totalContainers = containers.length;

    // Early exit if no new containers possible
    if (totalContainers <= knownHashes.size) {
      if (debug && pollCount % 5 === 0) {
        log.dim(
          `⏭️ [EXTRACT] No new containers (${totalContainers} total, ${knownHashes.size} known)`
        );
      }
      return null;
    }

    if (containers.length > 0) {
      // Only log every 5th poll to reduce noise
      if (debug && pollCount % 5 === 0) {
        log.dim(
          `🔍 [EXTRACT] Scanning ${totalContainers} containers (${knownHashes.size} known)`
        );
      }

      let skipped = 0;
      let empty = 0;

      // Scan ALL containers to find the FIRST with NEW text
      for (let idx = 0; idx < containers.length; idx++) {
        const container = containers[idx];
        try {
          const textElement = await container.$(RESPONSE_TEXT_CONTENT);
          if (textElement) {
            const text = await textElement.innerText();
            if (text && text.trim()) {
              // Hash-based comparison (faster & less memory)
              const textHash = hashString(text.trim());
              if (!knownHashes.has(textHash)) {
                log.success(
                  `✅ [EXTRACT] Found NEW text in container[${idx}]: ${text.trim().length} chars`
                );
                return text.trim();
              } else {
                skipped++;
              }
            } else {
              empty++;
            }
          }
        } catch {
          continue;
        }
      }

      // Only log summary if debug enabled
      if (debug && pollCount % 5 === 0) {
        log.dim(
          `⏭️ [EXTRACT] No NEW text (skipped ${skipped} known, ${empty} empty)`
        );
      }
      return null; // Don't fall through to fallback!
    } else {
      if (debug) {
        log.warning("⚠️ [EXTRACT] No containers found");
      }
    }
  } catch (error) {
    log.error(`❌ [EXTRACT] Primary selector failed: ${error}`);
  }

  // Fallback: Try other selectors (only if primary selector failed/found nothing)
  if (debug) {
    log.dim("🔄 [EXTRACT] Trying fallback selectors...");
  }

  for (const selector of RESPONSE_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      if (elements.length === 0) continue;

      // Scan ALL elements to find the first with NEW text
      for (const element of elements) {
        try {
          // Prefer full container text when available
          let container = element;
          try {
            const containerSelector = JS_CONTAINER_SELECTOR;
            const closest = await element.evaluateHandle((el, selector) => {
              return el.closest(selector);
            }, containerSelector);
            if (closest) {
              const closestEl = closest.asElement();
              if (closestEl) {
                container = closestEl as typeof element;
              }
            }
          } catch {
            container = element;
          }

          const text = await container.innerText();
          if (text && text.trim() && !knownHashes.has(hashString(text.trim()))) {
            return text.trim();
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  // Final fallback: JavaScript evaluation
  // Note: Code inside evaluate() runs in browser context where DOM globals exist
  try {
    const selectorsToUse = [...JS_EVAL_SELECTORS];
    const fallbackText = await page.evaluate((selectors: string[]): string | null => {
      const unique = new Set<Element>();

      const isVisible = (el: Element): boolean => {
        const htmlEl = el as HTMLElement;
        if (!el || !htmlEl.isConnected) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(htmlEl);
        if (
          style.visibility === "hidden" ||
          style.display === "none" ||
          parseFloat(style.opacity || "1") === 0
        ) {
          return false;
        }
        return true;
      };

      const candidates: string[] = [];
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (!isVisible(el)) continue;
          if (unique.has(el)) continue;
          unique.add(el);

          const htmlEl = el as HTMLElement;
          const text = htmlEl.innerText || htmlEl.textContent || "";
          if (!text.trim()) continue;

          candidates.push(text.trim());
        }
      }

      if (candidates.length > 0) {
        return candidates[candidates.length - 1];
      }

      return null;
    }, selectorsToUse);

    if (typeof fallbackText === "string" && fallbackText.trim()) {
      return fallbackText.trim();
    }
  } catch {
    // Ignore evaluation errors
  }

  return null;
}

