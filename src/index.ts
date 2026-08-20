#!/usr/bin/env node

/**
 * NotebookLM MCP Structured v1.1.0
 *
 * Enhanced MCP Server for NotebookLM with client-side prompt structuring
 * for source fidelity in professional document analysis.
 *
 * Fork of: https://github.com/PleasePrompto/notebooklm-mcp
 * Author: Paolo Dalprato
 *
 * Key Features (Structured Fork):
 * - Client-side prompt structuring for source fidelity
 * - Automatic question type detection (comparison, list, analysis, explanation, extraction)
 * - Citation requirements and [NOT FOUND IN DOCUMENTS] handling
 * - Automatic connection verification with auth recovery
 * - Multi-language support (tested with Italian)
 *
 * Inherited Features:
 * - Session-based contextual conversations
 * - Human-like typing and mouse movements
 * - Persistent browser fingerprint
 * - Stealth mode with Patchright
 *
 * Usage:
 *   node dist/index.js
 *
 * Environment Variables:
 *   NOTEBOOK_URL - Default NotebookLM notebook URL
 *   AUTO_LOGIN_ENABLED - Enable automatic login (true/false)
 *   LOGIN_EMAIL - Google email for auto-login
 *   LOGIN_PASSWORD - Google password for auto-login
 *   HEADLESS - Run browser in headless mode (true/false)
 *   MAX_SESSIONS - Maximum concurrent sessions (default: 10)
 *   SESSION_TIMEOUT - Session timeout in seconds (default: 900)
 *
 * See README.md for full documentation.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { CliHandler } from "./utils/cli-handler.js";
import { CONFIG, SERVER_VERSION } from "./config.js";
import { log } from "./utils/logger.js";
import { ServerCore, createServerCore, createMcpServer } from "./server-core.js";

/**
 * Setup graceful shutdown handlers for a given server core.
 */
function installShutdownHandlers(core: ServerCore): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    log.info(`\n🛑 Received ${signal}, shutting down gracefully...`);

    try {
      // Cleanup tool handlers (closes all sessions)
      await core.toolHandlers.cleanup();

      log.success("✅ Shutdown complete");
      process.exit(0);
    } catch (error) {
      log.error(`❌ Error during shutdown: ${error}`);
      process.exit(1);
    }
  };

  const requestShutdown = (signal: string) => {
    void shutdown(signal);
  };

  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  process.on("uncaughtException", (error) => {
    log.error(`💥 Uncaught exception: ${error}`);
    log.error(error.stack || "");
    requestShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error(`💥 Unhandled rejection at: ${promise}`);
    log.error(`Reason: ${reason}`);
    requestShutdown("unhandledRejection");
  });
}

/**
 * Run the server directly over stdio (single-client mode).
 */
async function runDirect(): Promise<void> {
  const core = createServerCore();
  installShutdownHandlers(core);
  const server = createMcpServer(core);

  log.info("🎯 Starting NotebookLM MCP Server...");
  log.info("");
  log.info("📝 Configuration:");
  log.info(`  Config Dir: ${CONFIG.configDir}`);
  log.info(`  Data Dir: ${CONFIG.dataDir}`);
  log.info(`  Headless: ${CONFIG.headless}`);
  log.info(`  Max Sessions: ${CONFIG.maxSessions}`);
  log.info(`  Session Timeout: ${CONFIG.sessionTimeout}s`);
  log.info(`  Stealth: ${CONFIG.stealthEnabled}`);
  log.info("");

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  log.success("✅ MCP Server connected via stdio");
  log.success("🎉 Ready to receive MCP requests!");
  log.info("");
  log.info("💡 Available tools:");
  for (const tool of core.toolDefinitions) {
    const desc = tool.description ? tool.description.split('\n')[0] : 'No description'; // First line only
    log.info(`  - ${tool.name}: ${desc.substring(0, 80)}...`);
  }
  log.info("");
  log.info("📖 For documentation, see: README.md");
  log.info("📖 For MCP details, see: MCP_INFOS.md");
  log.info("");
}

/**
 * Print the startup banner to stderr.
 */
function printBanner(): void {
  console.error("╔══════════════════════════════════════════════════════════╗");
  console.error("║                                                          ║");
  console.error(`║           NotebookLM MCP Server v${SERVER_VERSION}                   ║`);
  console.error("║                                                          ║");
  console.error("║   Chat with Gemini 2.5 through NotebookLM via MCP       ║");
  console.error("║                                                          ║");
  console.error("╚══════════════════════════════════════════════════════════╝");
  console.error("");
}

/**
 * Main entry point
 */
async function main() {
  // Handle CLI commands
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] === "config") {
    const cli = new CliHandler();
    await cli.handleCommand(args);
    process.exit(0);
  }

  if (args.includes("--backend")) {
    const { runBackend } = await import("./singleton/backend.js");
    await runBackend();
    return; // keeps running; exits via its own lifecycle
  }

  printBanner();

  try {
    if (!CONFIG.singletonEnabled) {
      await runDirect();
      return;
    }
    const { runProxy } = await import("./singleton/proxy.js");
    await runProxy();
  } catch (error) {
    log.error(`💥 Fatal error starting server: ${error}`);
    if (error instanceof Error) {
      log.error(error.stack || "");
    }
    process.exit(1);
  }
}

// Run the server
main();
