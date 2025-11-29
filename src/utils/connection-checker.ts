/**
 * Connection Checker for NotebookLM MCP
 *
 * Handles:
 * - Chrome process detection (cross-platform)
 * - Authentication state validation
 * - Connection readiness check before tool execution
 *
 * This module ensures that the MCP can connect to NotebookLM
 * before attempting any operation that requires it.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { AuthManager } from "../auth/auth-manager.js";
import { log } from "./logger.js";

const execAsync = promisify(exec);

/**
 * Result of a connection check
 */
export interface ConnectionCheckResult {
  /** Whether the connection is ready to use */
  isReady: boolean;
  /** Whether authentication state is valid */
  authValid: boolean;
  /** Whether Chrome browser is currently running */
  chromeRunning: boolean;
  /** Informational message about the state */
  message: string;
  /** Whether user action is required before proceeding */
  requiresUserAction: boolean;
  /** Message to show to the user if action is required */
  userActionMessage?: string;
  /** Whether auto-auth can be attempted */
  canAutoAuth: boolean;
}

/**
 * Connection Checker
 *
 * Verifies that the MCP can connect to NotebookLM by checking:
 * 1. Authentication state validity
 * 2. Chrome browser status (must be closed for auth)
 */
export class ConnectionChecker {
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
  }

  /**
   * Check if Chrome browser is currently running
   *
   * Cross-platform detection:
   * - Windows: tasklist for chrome.exe
   * - macOS: pgrep for "Google Chrome"
   * - Linux: pgrep for chrome/chromium
   *
   * @returns true if Chrome is running, false otherwise
   */
  async isChromeRunning(): Promise<boolean> {
    const platform = process.platform;

    try {
      if (platform === "win32") {
        // Windows: Check for chrome.exe process
        const { stdout } = await execAsync(
          'tasklist /FI "IMAGENAME eq chrome.exe" /NH 2>nul',
          { timeout: 5000 }
        );
        // If chrome.exe is found, stdout will contain process info
        // If not found, stdout will be empty or contain "INFO: No tasks..."
        const isRunning = stdout.toLowerCase().includes("chrome.exe");
        log.info(`  🔍 Chrome check (Windows): ${isRunning ? "RUNNING" : "NOT RUNNING"}`);
        return isRunning;
      } else if (platform === "darwin") {
        // macOS: Check for Google Chrome process
        try {
          await execAsync('pgrep -x "Google Chrome"', { timeout: 5000 });
          log.info("  🔍 Chrome check (macOS): RUNNING");
          return true;
        } catch {
          // pgrep returns exit code 1 if no process found
          log.info("  🔍 Chrome check (macOS): NOT RUNNING");
          return false;
        }
      } else {
        // Linux: Check for chrome or chromium
        try {
          // Try chrome first
          await execAsync("pgrep -x chrome", { timeout: 5000 });
          log.info("  🔍 Chrome check (Linux): RUNNING");
          return true;
        } catch {
          try {
            // Try chromium
            await execAsync("pgrep -x chromium", { timeout: 5000 });
            log.info("  🔍 Chrome check (Linux): RUNNING (chromium)");
            return true;
          } catch {
            log.info("  🔍 Chrome check (Linux): NOT RUNNING");
            return false;
          }
        }
      }
    } catch (error) {
      // If we can't determine, assume Chrome might be running (safer)
      log.warning(`  ⚠️  Could not determine Chrome status: ${error}`);
      return true;
    }
  }

  /**
   * Check if authentication state is valid
   *
   * Checks:
   * - state.json exists
   * - state.json is not expired (< 24h old)
   *
   * @returns true if auth state is valid
   */
  async isAuthValid(): Promise<boolean> {
    const statePath = await this.authManager.getValidStatePath();
    return statePath !== null;
  }

  /**
   * Perform a complete connection readiness check
   *
   * This is the main method to call before executing any tool
   * that requires a connection to NotebookLM.
   *
   * @returns ConnectionCheckResult with detailed status and messages
   */
  async checkConnection(): Promise<ConnectionCheckResult> {
    log.info("🔌 Checking NotebookLM connection readiness...");

    // Step 1: Check if authentication state is valid
    const authValid = await this.isAuthValid();

    if (authValid) {
      log.success("  ✅ Authentication state is valid");
      return {
        isReady: true,
        authValid: true,
        chromeRunning: false, // Don't need to check if auth is valid
        message: "Connection ready - authentication is valid",
        requiresUserAction: false,
        canAutoAuth: false,
      };
    }

    log.warning("  ⚠️  Authentication state is invalid or expired");

    // Step 2: Auth is invalid - check if Chrome is running
    const chromeRunning = await this.isChromeRunning();

    if (chromeRunning) {
      // Chrome is running - user must close it first
      log.warning("  🚫 Chrome is running - cannot proceed with authentication");
      return {
        isReady: false,
        authValid: false,
        chromeRunning: true,
        message: "Authentication required but Chrome is running",
        requiresUserAction: true,
        userActionMessage:
          "⚠️ **Autenticazione NotebookLM richiesta**\n\n" +
          "Per poter procedere, devi prima **chiudere completamente Chrome** " +
          "(tutte le finestre).\n\n" +
          "Questo è necessario perché l'autenticazione richiede l'accesso esclusivo " +
          "al profilo Chrome.\n\n" +
          "**Cosa fare:**\n" +
          "1. Chiudi tutte le finestre di Chrome\n" +
          "2. Conferma qui quando hai finito\n" +
          "3. Si aprirà una finestra per il login a Google\n\n" +
          "⏱️ Timeout: 1 minuto",
        canAutoAuth: false,
      };
    }

    // Chrome is not running - can proceed with auto-auth
    log.info("  ✅ Chrome is not running - can proceed with authentication");
    return {
      isReady: false,
      authValid: false,
      chromeRunning: false,
      message: "Authentication required - Chrome is closed, ready for login",
      requiresUserAction: false,
      canAutoAuth: true,
    };
  }

  /**
   * Wait for user to close Chrome (with timeout)
   *
   * This method polls for Chrome status until either:
   * - Chrome is closed (returns true)
   * - Timeout is reached (returns false)
   *
   * @param timeoutMs Maximum time to wait in milliseconds (default: 60000 = 1 minute)
   * @param pollIntervalMs How often to check in milliseconds (default: 2000 = 2 seconds)
   * @returns true if Chrome was closed within timeout, false otherwise
   */
  async waitForChromeClose(
    timeoutMs: number = 60000,
    pollIntervalMs: number = 2000
  ): Promise<boolean> {
    log.info(`  ⏳ Waiting for Chrome to close (timeout: ${timeoutMs / 1000}s)...`);

    const startTime = Date.now();
    const endTime = startTime + timeoutMs;

    while (Date.now() < endTime) {
      const chromeRunning = await this.isChromeRunning();

      if (!chromeRunning) {
        log.success("  ✅ Chrome is now closed");
        return true;
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      // Log progress every 10 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed % 10000 < pollIntervalMs) {
        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        log.info(`  ⏳ Still waiting for Chrome to close (${remaining}s remaining)...`);
      }
    }

    log.warning("  ⏱️  Timeout waiting for Chrome to close");
    return false;
  }
}
