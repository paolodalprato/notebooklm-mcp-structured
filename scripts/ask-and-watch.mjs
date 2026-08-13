#!/usr/bin/env node
/**
 * Diagnostic tool: ask one question and watch the DOM while Gemini answers.
 *
 * Costs one query. It exists to answer a question that a finished
 * conversation cannot answer: what marks the END of generation?
 *
 * Text stability is not enough. A status line that sits still for three
 * seconds is currently accepted as the final answer, which is how a session
 * ends up returning a loading message. We need a positive completion signal,
 * and this script records the candidates every two seconds:
 * - .message-actions (copy / rate buttons) inside the response container
 * - thinking-chain-view (does it exist during generation, or only after?)
 * - the buttons around the query box (send may turn into stop while running)
 * - the text the server's own extraction would capture at that instant
 *
 * Usage:
 *   node scripts/ask-and-watch.mjs <notebookUrl> "<question>"
 *
 * Run with Claude Desktop closed: the Chrome profile must be free.
 * Writes scripts/ask-watch-timeline.txt
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "patchright";
import { CONFIG } from "../dist/config.js";
import { snapshotAllResponses } from "../dist/utils/page-utils.js";
import { CHAT_INPUT_SELECTORS } from "../dist/selectors.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(scriptDir, "ask-watch-timeline.txt");

const notebookUrl = process.argv[2];
const question = process.argv[3];

if (!notebookUrl || !question) {
  console.error('Usage: node scripts/ask-and-watch.mjs <notebookUrl> "<question>"');
  process.exit(1);
}

const WATCH_INTERVAL_MS = 2000;
const WATCH_TIMEOUT_MS = 240000; // 4 minutes, longer than the server's wait

/** Runs in the page: collect the completion-signal candidates. */
function probe() {
  const containers = Array.from(document.querySelectorAll(".to-user-container"));
  const last = containers[containers.length - 1] || null;

  const buttonLabels = Array.from(
    document.querySelectorAll(".query-box button, .query-box-container button")
  )
    .map((b) => b.getAttribute("aria-label") || b.textContent.trim().slice(0, 20))
    .filter(Boolean);

  return {
    containers: containers.length,
    actionsInLast: last ? last.querySelectorAll(".message-actions").length : 0,
    thoughtsInLast: last ? last.querySelectorAll("thinking-chain-view").length : 0,
    buttons: buttonLabels.join(" | "),
  };
}

async function main() {
  const statePath = path.join(CONFIG.browserStateDir, "state.json");
  const hasState = fs.existsSync(statePath);
  const lines = [];
  const record = (line) => {
    console.log(line);
    lines.push(line);
  };

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
    console.error("Could not open the browser profile:", error.message);
    console.error("Close Claude Desktop and any Chrome using this profile, then retry.");
    process.exit(1);
  }

  try {
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    record(`Opening ${notebookUrl}`);
    await page.goto(notebookUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(8000);

    // Answers already there: anything new belongs to our question.
    const before = await snapshotAllResponses(page);
    record(`Answers already present: ${before.length}`);

    let inputSelector = null;
    for (const selector of CHAT_INPUT_SELECTORS) {
      if (await page.$(selector)) {
        inputSelector = selector;
        break;
      }
    }
    if (!inputSelector) throw new Error("Chat input not found");
    record(`Chat input: ${inputSelector}`);

    await page.fill(inputSelector, question);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    record(`Question submitted at t=0`);
    record("");
    record("t(s) | cont | actions | thoughts | chars | buttons | head");

    const startedAt = Date.now();
    let lastText = "";
    let stable = 0;

    while (Date.now() - startedAt < WATCH_TIMEOUT_MS) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const signals = await page.evaluate(probe);
      const answers = await snapshotAllResponses(page);
      const fresh = answers.filter((a) => !before.includes(a));
      const text = fresh.length > 0 ? fresh[fresh.length - 1] : "";
      const head = text.replace(/\s+/g, " ").slice(0, 60);

      record(
        `${String(elapsed).padStart(4)} | ${String(signals.containers).padStart(4)} | ` +
          `${String(signals.actionsInLast).padStart(7)} | ${String(signals.thoughtsInLast).padStart(8)} | ` +
          `${String(text.length).padStart(5)} | ${signals.buttons} | ${head}`
      );

      // Stop once the text has been still for 5 rounds (10 seconds).
      if (text && text === lastText) {
        stable++;
        if (stable >= 5) {
          record("");
          record(`Text stable for 10s: generation looks finished at t=${elapsed}s`);
          break;
        }
      } else {
        stable = 0;
        lastText = text;
      }

      await page.waitForTimeout(WATCH_INTERVAL_MS);
    }

    record("");
    record(`Final captured length: ${lastText.length} chars`);
    record(`Final head: ${lastText.replace(/\s+/g, " ").slice(0, 200)}`);
  } catch (error) {
    record(`FAILED: ${error.message}`);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(outFile, lines.join("\n"), "utf-8");
    console.log("");
    console.log("Timeline written to:", outFile);
    await context.close().catch(() => {});
  }
}

main();
