#!/usr/bin/env node
/**
 * Diagnostic tool: dump the chat DOM of a Gemini Notebook page.
 *
 * Read-only. It opens an existing notebook with the persistent profile and
 * inspects the DOM of a conversation that is already there. It never submits
 * a question, so it does not consume the daily query quota.
 *
 * Why it exists: response capture relies on CSS classes that Google changes
 * without notice (the July 2026 rebrand broke them). Guessing new selectors
 * is unreliable, so we read the real markup instead.
 *
 * Usage:
 *   node scripts/dump-chat-dom.mjs <notebookUrl> [markerText]
 *
 *   markerText is a distinctive string taken from an ANSWER already visible
 *   in that notebook's chat. It anchors the search. Defaults to "Thoughts".
 *
 * Requirements: run with Claude Desktop closed, otherwise the MCP server holds
 * a lock on the Chrome profile and this script would fall back to a profile
 * without cookies.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "patchright";
import { CONFIG } from "../dist/config.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(scriptDir, "chat-dom-dump.txt");

const notebookUrl = process.argv[2];
const marker = process.argv[3] || "Thoughts";

if (!notebookUrl) {
  console.error("Missing notebook URL.");
  console.error("Usage: node scripts/dump-chat-dom.mjs <notebookUrl> [markerText]");
  process.exit(1);
}

/** Selectors the server currently relies on, checked for survival. */
const CURRENT_SELECTORS = {
  chatInputPrimary: "textarea.query-box-input",
  chatInputFallback: 'textarea[aria-label="Enter a query"]',
  responseContainer: ".to-user-container",
  responseText: ".message-text-content",
  thinkingIndicator: "div.thinking-message",
};

/**
 * Runs inside the browser. Returns a plain-text report, built there because
 * DOM nodes cannot cross the evaluate() boundary.
 */
function inspectPage({ marker, selectors }) {
  const lines = [];
  const say = (s = "") => lines.push(s);

  /** Compact description of one element: tag, id, classes, data-* attributes. */
  const describe = (el) => {
    if (!el || !el.tagName) return "(none)";
    let out = el.tagName.toLowerCase();
    if (el.id) out += "#" + el.id;
    const cls = (el.getAttribute("class") || "").trim();
    if (cls) out += "." + cls.split(/\s+/).join(".");
    for (const attr of el.getAttributeNames()) {
      if (attr.startsWith("data-") || attr === "role" || attr === "aria-label") {
        out += ` [${attr}="${(el.getAttribute(attr) || "").slice(0, 40)}"]`;
      }
    }
    return out;
  };

  const preview = (el, n = 70) =>
    (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, n);

  say("=== 1. CURRENT SELECTORS: do they still match anything? ===");
  for (const [name, sel] of Object.entries(selectors)) {
    let count = -1;
    try {
      count = document.querySelectorAll(sel).length;
    } catch {
      // Invalid selector in this browser: report as unusable.
    }
    say(`${name.padEnd(20)} ${sel.padEnd(40)} -> ${count} match`);
  }

  say("");
  say("=== 2. CLASS NAMES THAT LOOK CONVERSATIONAL ===");
  // Heuristic sweep: the new markup keeps semantic words in class names.
  const words = ["message", "chat", "response", "turn", "thought", "answer", "query", "prompt"];
  const tally = new Map();
  for (const el of document.querySelectorAll("*")) {
    const cls = (el.getAttribute("class") || "").trim();
    if (!cls) continue;
    for (const token of cls.split(/\s+/)) {
      if (words.some((w) => token.toLowerCase().includes(w))) {
        tally.set(token, (tally.get(token) || 0) + 1);
      }
    }
  }
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  for (const [token, count] of sorted.slice(0, 60)) {
    say(`${String(count).padStart(4)}x  .${token}`);
  }
  if (sorted.length === 0) say("(none found: markup may use no semantic classes)");

  say("");
  say(`=== 3. ANCESTOR CHAIN OF THE MARKER TEXT ("${marker}") ===`);
  // Deepest elements holding the marker: their ancestors are the real containers.
  const holders = [...document.querySelectorAll("*")].filter((el) => {
    const txt = el.innerText || "";
    if (!txt.includes(marker)) return false;
    return ![...el.children].some((c) => (c.innerText || "").includes(marker));
  });
  say(`deepest elements containing the marker: ${holders.length}`);
  holders.slice(0, 3).forEach((el, i) => {
    say("");
    say(`--- marker element #${i} ---`);
    let node = el;
    let level = 0;
    while (node && node.tagName !== "BODY" && level < 12) {
      const len = (node.innerText || "").length;
      say(`  [${String(level).padStart(2)}] ${describe(node)}  (text ${len} chars)`);
      node = node.parentElement;
      level++;
    }
  });

  say("");
  say("=== 4. SIBLING STRUCTURE AROUND THE MARKER ===");
  // Shows how the answer sits next to the thoughts block and the question.
  if (holders.length > 0) {
    let node = holders[0];
    for (let i = 0; i < 5 && node.parentElement; i++) node = node.parentElement;
    say(`container inspected: ${describe(node)}`);
    [...node.children].forEach((child, i) => {
      say(`  child[${i}] ${describe(child)}`);
      say(`           text: "${preview(child, 90)}"`);
    });
  } else {
    say("(marker not found: pass a string taken from a visible answer)");
  }

  return lines.join("\n");
}

async function main() {
  const statePath = path.join(CONFIG.browserStateDir, "state.json");
  const hasState = fs.existsSync(statePath);

  console.log("Profile:", CONFIG.chromeProfileDir);
  console.log("Auth state:", hasState ? statePath : "(none, login may be required)");

  let context;
  try {
    context = await chromium.launchPersistentContext(CONFIG.chromeProfileDir, {
      headless: false,
      channel: "chrome",
      chromiumSandbox: true,
      viewport: CONFIG.viewport,
      locale: "en-US",
      timezoneId: "Europe/Berlin",
      ...(hasState && { storageState: statePath }),
      args: ["--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
    });
  } catch (error) {
    // The usual cause is Chrome holding the profile lock (Claude Desktop open).
    console.error("Could not open the browser profile:", error.message);
    console.error("Close Claude Desktop and any Chrome window using this profile, then retry.");
    process.exit(1);
  }

  try {
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    console.log("Opening", notebookUrl);
    await page.goto(notebookUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // The chat is rendered client-side: give it time to paint before reading.
    await page.waitForTimeout(8000);

    const header = [
      `URL:    ${page.url()}`,
      `Title:  ${await page.title()}`,
      `Marker: ${marker}`,
      "",
    ].join("\n");

    const report = await page.evaluate(inspectPage, {
      marker,
      selectors: CURRENT_SELECTORS,
    });

    fs.writeFileSync(outFile, header + report, "utf-8");
    console.log("");
    console.log("Report written to:", outFile);
    console.log("Keep the window open if you want to inspect it by hand, then press Ctrl+C.");

    // Stay open briefly so the page can be checked visually before closing.
    await page.waitForTimeout(15000);
  } catch (error) {
    console.error("Inspection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
