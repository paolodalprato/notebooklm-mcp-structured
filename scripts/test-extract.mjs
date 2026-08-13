#!/usr/bin/env node
/**
 * Diagnostic tool: run the server's own extraction code against a notebook
 * conversation that is already complete.
 *
 * Read-only: it opens the page and reads it, it never asks anything, so no
 * query quota is consumed. It imports snapshotAllResponses() from the built
 * server, so what it prints is exactly what the MCP would capture.
 *
 * Answers the question "is extraction broken, or was it just too slow?":
 * - answers printed, with no "Thoughts" prefix -> extraction works
 * - nothing printed, or text starting with "Thoughts" -> extraction is wrong
 *
 * Usage:
 *   node scripts/test-extract.mjs <notebookUrl>
 *
 * Run with Claude Desktop closed, otherwise the Chrome profile is locked.
 */

import fs from "fs";
import path from "path";
import { chromium } from "patchright";
import { CONFIG } from "../dist/config.js";
import { snapshotAllResponses } from "../dist/utils/page-utils.js";

const notebookUrl = process.argv[2];

if (!notebookUrl) {
  console.error("Usage: node scripts/test-extract.mjs <notebookUrl>");
  process.exit(1);
}

async function main() {
  const statePath = path.join(CONFIG.browserStateDir, "state.json");
  const hasState = fs.existsSync(statePath);

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

    console.log("Opening", notebookUrl);
    await page.goto(notebookUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(8000);

    const answers = await snapshotAllResponses(page);

    console.log("");
    console.log(`Answers captured: ${answers.length}`);
    answers.forEach((text, i) => {
      const startsWithThoughts = text.trimStart().toLowerCase().startsWith("thoughts");
      console.log("");
      console.log(`--- answer #${i} (${text.length} chars) ---`);
      console.log(`starts with "Thoughts": ${startsWithThoughts ? "YES (BAD)" : "no (good)"}`);
      console.log(text.slice(0, 400).replace(/\s+/g, " "));
    });
  } catch (error) {
    console.error("Extraction test failed:", error.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
