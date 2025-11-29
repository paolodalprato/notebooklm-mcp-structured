/**
 * MCP Tool Handlers
 *
 * Implements the logic for all MCP tools.
 */

import { SessionManager } from "../session/session-manager.js";
import { AuthManager } from "../auth/auth-manager.js";
import { NotebookLibrary } from "../library/notebook-library.js";
import type { AddNotebookInput, UpdateNotebookInput } from "../library/types.js";
import { CONFIG, applyBrowserOptions, type BrowserOptions } from "../config.js";
import { log } from "../utils/logger.js";
import type {
  AskQuestionResult,
  ToolResult,
  ProgressCallback,
} from "../types.js";
import { RateLimitError } from "../errors.js";
import { CleanupManager } from "../utils/cleanup-manager.js";
import { ConnectionChecker } from "../utils/connection-checker.js";

const FOLLOW_UP_REMINDER =
  "\n\nEXTREMELY IMPORTANT: Is that ALL you need to know? You can always ask another question using the same session ID! Think about it carefully: before you reply to the user, review their original request and this answer. If anything is still unclear or missing, ask me another question first.";

/**
 * MCP Tool Handlers
 */
export class ToolHandlers {
  private sessionManager: SessionManager;
  private authManager: AuthManager;
  private library: NotebookLibrary;
  private connectionChecker: ConnectionChecker;

  constructor(sessionManager: SessionManager, authManager: AuthManager, library: NotebookLibrary) {
    this.sessionManager = sessionManager;
    this.authManager = authManager;
    this.library = library;
    this.connectionChecker = new ConnectionChecker(authManager);
  }

  // ============================================================================
  // Connection Pre-Check (Session Start Verification)
  // ============================================================================

  /**
   * Ensure connection to NotebookLM is ready before executing a tool
   *
   * This method is called automatically before any tool that requires
   * a connection to NotebookLM (e.g., ask_question).
   *
   * Flow:
   * 1. Check if auth state is valid → proceed if yes
   * 2. If auth invalid, check if Chrome is running
   * 3. If Chrome running → return error asking user to close it
   * 4. If Chrome closed → perform auto-auth and proceed
   *
   * @param sendProgress Optional progress callback for UI updates
   * @returns ConnectionCheckResult or null if ready to proceed
   */
  async ensureConnectionReady(
    sendProgress?: ProgressCallback
  ): Promise<{ ready: true } | { ready: false; result: ToolResult<any> }> {
    log.info("🔌 [PRE-CHECK] Verifying NotebookLM connection...");
    await sendProgress?.("Verifying NotebookLM connection...", 0, 5);

    const checkResult = await this.connectionChecker.checkConnection();

    if (checkResult.isReady) {
      log.success("✅ [PRE-CHECK] Connection ready");
      return { ready: true };
    }

    // Auth not valid - need to handle
    if (checkResult.requiresUserAction) {
      // Chrome is running - user must close it
      log.warning("🚫 [PRE-CHECK] Chrome is running - user action required");
      return {
        ready: false,
        result: {
          success: false,
          error: checkResult.userActionMessage || "Chrome must be closed before authentication",
          data: {
            status: "chrome_running",
            requires_action: true,
            action: "close_chrome",
            message: checkResult.userActionMessage,
            timeout_seconds: 60,
          } as any,
        },
      };
    }

    if (checkResult.canAutoAuth) {
      // Chrome is closed - can proceed with auto-auth
      log.info("🔐 [PRE-CHECK] Starting automatic authentication...");
      await sendProgress?.("Authentication required - starting login...", 1, 5);

      try {
        // Perform interactive authentication
        const authSuccess = await this.authManager.performSetup(sendProgress);

        if (authSuccess) {
          log.success("✅ [PRE-CHECK] Authentication successful");
          await sendProgress?.("Authentication successful!", 2, 5);
          return { ready: true };
        } else {
          log.error("❌ [PRE-CHECK] Authentication failed");
          return {
            ready: false,
            result: {
              success: false,
              error:
                "Authentication failed. Please try again or use the setup_auth tool directly.\n\n" +
                "If the problem persists, try:\n" +
                "1. Close all Chrome windows\n" +
                "2. Run cleanup_data(confirm=true) to reset\n" +
                "3. Try your request again",
            },
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`❌ [PRE-CHECK] Authentication error: ${errorMessage}`);
        return {
          ready: false,
          result: {
            success: false,
            error: `Authentication error: ${errorMessage}`,
          },
        };
      }
    }

    // Fallback - should not reach here
    log.error("❌ [PRE-CHECK] Unexpected state");
    return {
      ready: false,
      result: {
        success: false,
        error: "Unexpected connection state. Please try setup_auth manually.",
      },
    };
  }

  /**
   * Handle ask_question tool
   */
  async handleAskQuestion(
    args: {
      question: string;
      session_id?: string;
      notebook_id?: string;
      notebook_url?: string;
      show_browser?: boolean;
      browser_options?: BrowserOptions;
    },
    sendProgress?: ProgressCallback
  ): Promise<ToolResult<AskQuestionResult>> {
    const {
      question,
      session_id,
      notebook_id,
      notebook_url,
      show_browser,
      browser_options
    } = args;

    log.info(`🔧 [TOOL] ask_question called`);
    log.info(`  Question: "${question.substring(0, 100)}"...`);
    if (session_id) {
      log.info(`  Session ID: ${session_id}`);
    }
    if (notebook_id) {
      log.info(`  Notebook ID: ${notebook_id}`);
    }
    if (notebook_url) {
      log.info(`  Notebook URL: ${notebook_url}`);
    }

    // =========================================================================
    // PRE-CHECK: Verify connection to NotebookLM is ready
    // =========================================================================
    const connectionCheck = await this.ensureConnectionReady(sendProgress);
    if (!connectionCheck.ready) {
      log.warning("🚫 [TOOL] ask_question blocked - connection not ready");
      return connectionCheck.result as ToolResult<AskQuestionResult>;
    }
    // =========================================================================

    try {
      // Resolve notebook URL
      let resolvedNotebookUrl = notebook_url;

      if (!resolvedNotebookUrl && notebook_id) {
        const notebook = this.library.incrementUseCount(notebook_id);
        if (!notebook) {
          throw new Error(`Notebook not found in library: ${notebook_id}`);
        }

        resolvedNotebookUrl = notebook.url;
        log.info(`  Resolved notebook: ${notebook.name}`);
      } else if (!resolvedNotebookUrl) {
        const active = this.library.getActiveNotebook();
        if (active) {
          const notebook = this.library.incrementUseCount(active.id);
          if (!notebook) {
            throw new Error(`Active notebook not found: ${active.id}`);
          }
          resolvedNotebookUrl = notebook.url;
          log.info(`  Using active notebook: ${notebook.name}`);
        }
      }

      // Progress: Getting or creating session
      await sendProgress?.("Getting or creating browser session...", 1, 5);

      // Apply browser options temporarily
      const originalConfig = { ...CONFIG };
      const effectiveConfig = applyBrowserOptions(browser_options, show_browser);
      Object.assign(CONFIG, effectiveConfig);

      // Calculate overrideHeadless parameter for session manager
      // show_browser takes precedence over browser_options.headless
      let overrideHeadless: boolean | undefined = undefined;
      if (show_browser !== undefined) {
        overrideHeadless = show_browser;
      } else if (browser_options?.show !== undefined) {
        overrideHeadless = browser_options.show;
      } else if (browser_options?.headless !== undefined) {
        overrideHeadless = !browser_options.headless;
      }

      try {
        // Get or create session (with headless override to handle mode changes)
        const session = await this.sessionManager.getOrCreateSession(
          session_id,
          resolvedNotebookUrl,
          overrideHeadless
        );

      // Progress: Asking question
      await sendProgress?.("Asking question to NotebookLM...", 2, 5);

      // Ask the question directly (pass progress callback)
      const rawAnswer = await session.ask(question, sendProgress);

      const answer = `${rawAnswer.trimEnd()}${FOLLOW_UP_REMINDER}`;

      // Get session info
      const sessionInfo = session.getInfo();

      const result: AskQuestionResult = {
        status: "success",
        question,
        answer,
        session_id: session.sessionId,
        notebook_url: session.notebookUrl,
        session_info: {
          age_seconds: sessionInfo.age_seconds,
          message_count: sessionInfo.message_count,
          last_activity: sessionInfo.last_activity,
        },
      };

        // Progress: Complete
        await sendProgress?.("Question answered successfully!", 5, 5);

        log.success(`✅ [TOOL] ask_question completed successfully`);
        return {
          success: true,
          data: result,
        };
      } finally {
        // Restore original CONFIG
        Object.assign(CONFIG, originalConfig);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Special handling for rate limit errors
      if (error instanceof RateLimitError || errorMessage.toLowerCase().includes("rate limit")) {
        log.error(`🚫 [TOOL] Rate limit detected`);
        return {
          success: false,
          error:
            "NotebookLM rate limit reached (50 queries/day for free accounts).\n\n" +
            "You can:\n" +
            "1. Use the 're_auth' tool to login with a different Google account\n" +
            "2. Wait until tomorrow for the quota to reset\n" +
            "3. Upgrade to Google AI Pro/Ultra for 5x higher limits\n\n" +
            `Original error: ${errorMessage}`,
        };
      }

      log.error(`❌ [TOOL] ask_question failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle list_sessions tool
   */
  async handleListSessions(): Promise<
    ToolResult<{
      active_sessions: number;
      max_sessions: number;
      session_timeout: number;
      oldest_session_seconds: number;
      total_messages: number;
      sessions: Array<{
        id: string;
        created_at: number;
        last_activity: number;
        age_seconds: number;
        inactive_seconds: number;
        message_count: number;
        notebook_url: string;
      }>;
    }> 
  > {
    log.info(`🔧 [TOOL] list_sessions called`);

    try {
      const stats = this.sessionManager.getStats();
      const sessions = this.sessionManager.getAllSessionsInfo();

      const result = {
        active_sessions: stats.active_sessions,
        max_sessions: stats.max_sessions,
        session_timeout: stats.session_timeout,
        oldest_session_seconds: stats.oldest_session_seconds,
        total_messages: stats.total_messages,
        sessions: sessions.map((info) => ({
          id: info.id,
          created_at: info.created_at,
          last_activity: info.last_activity,
          age_seconds: info.age_seconds,
          inactive_seconds: info.inactive_seconds,
          message_count: info.message_count,
          notebook_url: info.notebook_url,
        })),
      };

      log.success(
        `✅ [TOOL] list_sessions completed (${result.active_sessions} sessions)`
      );
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] list_sessions failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle close_session tool
   */
  async handleCloseSession(args: { session_id: string }): Promise<
    ToolResult<{ status: string; message: string; session_id: string }>
  > {
    const { session_id } = args;

    log.info(`🔧 [TOOL] close_session called`);
    log.info(`  Session ID: ${session_id}`);

    try {
      const closed = await this.sessionManager.closeSession(session_id);

      if (closed) {
        log.success(`✅ [TOOL] close_session completed`);
        return {
          success: true,
          data: {
            status: "success",
            message: `Session ${session_id} closed successfully`,
            session_id,
          },
        };
      } else {
        log.warning(`⚠️  [TOOL] Session ${session_id} not found`);
        return {
          success: false,
          error: `Session ${session_id} not found`,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] close_session failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle reset_session tool
   */
  async handleResetSession(
    args: { session_id: string },
    sendProgress?: ProgressCallback
  ): Promise<
    ToolResult<{ status: string; message: string; session_id: string }>
  > {
    const { session_id } = args;

    log.info(`🔧 [TOOL] reset_session called`);
    log.info(`  Session ID: ${session_id}`);

    // =========================================================================
    // PRE-CHECK: Verify connection to NotebookLM is ready
    // =========================================================================
    const connectionCheck = await this.ensureConnectionReady(sendProgress);
    if (!connectionCheck.ready) {
      log.warning("🚫 [TOOL] reset_session blocked - connection not ready");
      return connectionCheck.result as ToolResult<{ status: string; message: string; session_id: string }>;
    }
    // =========================================================================

    try {
      const session = this.sessionManager.getSession(session_id);

      if (!session) {
        log.warning(`⚠️  [TOOL] Session ${session_id} not found`);
        return {
          success: false,
          error: `Session ${session_id} not found`,
        };
      }

      await session.reset();

      log.success(`✅ [TOOL] reset_session completed`);
      return {
        success: true,
        data: {
          status: "success",
          message: `Session ${session_id} reset successfully`,
          session_id,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] reset_session failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle get_health tool
   *
   * Enhanced with connection status check including Chrome browser state.
   * This is a diagnostic tool - it reports status but does NOT block or auto-fix.
   */
  async handleGetHealth(): Promise<
    ToolResult<{
      status: string;
      authenticated: boolean;
      connection_ready: boolean;
      chrome_running: boolean;
      notebook_url: string;
      active_sessions: number;
      max_sessions: number;
      session_timeout: number;
      total_messages: number;
      headless: boolean;
      auto_login_enabled: boolean;
      stealth_enabled: boolean;
      troubleshooting_tip?: string;
    }>
  > {
    log.info(`🔧 [TOOL] get_health called`);

    try {
      // Check authentication status
      const statePath = await this.authManager.getValidStatePath();
      const authenticated = statePath !== null;

      // Check connection status (including Chrome state)
      const connectionStatus = await this.connectionChecker.checkConnection();
      const chromeRunning = await this.connectionChecker.isChromeRunning();

      // Get session stats
      const stats = this.sessionManager.getStats();

      // Determine overall status
      let status = "ok";
      if (!authenticated) {
        status = chromeRunning ? "auth_required_chrome_open" : "auth_required";
      }

      const result = {
        status,
        authenticated,
        connection_ready: connectionStatus.isReady,
        chrome_running: chromeRunning,
        notebook_url: CONFIG.notebookUrl || "not configured",
        active_sessions: stats.active_sessions,
        max_sessions: stats.max_sessions,
        session_timeout: stats.session_timeout,
        total_messages: stats.total_messages,
        headless: CONFIG.headless,
        auto_login_enabled: CONFIG.autoLoginEnabled,
        stealth_enabled: CONFIG.stealthEnabled,
        // Add troubleshooting tip based on status
        ...((!authenticated) && {
          troubleshooting_tip: chromeRunning
            ? "Chrome is running. Close all Chrome windows first, then retry your request or use setup_auth."
            : "Authentication required. Your next request will automatically open a browser for login."
        }),
      };

      log.success(`✅ [TOOL] get_health completed`);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] get_health failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle setup_auth tool
   *
   * Opens a browser window for manual login with live progress updates.
   * The operation waits synchronously for login completion (up to 10 minutes).
   */
  async handleSetupAuth(
    args: {
      show_browser?: boolean;
      browser_options?: BrowserOptions;
    },
    sendProgress?: ProgressCallback
  ): Promise<
    ToolResult<{
      status: string;
      message: string;
      authenticated: boolean;
      duration_seconds?: number;
    }> 
  > {
    const { show_browser, browser_options } = args;

    // CRITICAL: Send immediate progress to reset timeout from the very start
    await sendProgress?.("Initializing authentication setup...", 0, 10);

    log.info(`🔧 [TOOL] setup_auth called`);
    if (show_browser !== undefined) {
      log.info(`  Show browser: ${show_browser}`);
    }

    const startTime = Date.now();

    // Apply browser options temporarily
    const originalConfig = { ...CONFIG };
    const effectiveConfig = applyBrowserOptions(browser_options, show_browser);
    Object.assign(CONFIG, effectiveConfig);

    try {
      // Progress: Starting
      await sendProgress?.("Preparing authentication browser...", 1, 10);

      log.info(`  🌐 Opening browser for interactive login...`);

      // Progress: Opening browser
      await sendProgress?.("Opening browser window...", 2, 10);

      // Perform setup with progress updates (uses CONFIG internally)
      const success = await this.authManager.performSetup(sendProgress);

      const durationSeconds = (Date.now() - startTime) / 1000;

      if (success) {
        // Progress: Complete
        await sendProgress?.("Authentication saved successfully!", 10, 10);

        log.success(`✅ [TOOL] setup_auth completed (${durationSeconds.toFixed(1)}s)`);
        return {
          success: true,
          data: {
            status: "authenticated",
            message: "Successfully authenticated and saved browser state",
            authenticated: true,
            duration_seconds: durationSeconds,
          },
        };
      } else {
        log.error(`❌ [TOOL] setup_auth failed (${durationSeconds.toFixed(1)}s)`);
        return {
          success: false,
          error: "Authentication failed or was cancelled",
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const durationSeconds = (Date.now() - startTime) / 1000;
      log.error(`❌ [TOOL] setup_auth failed: ${errorMessage} (${durationSeconds.toFixed(1)}s)`);
      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      // Restore original CONFIG
      Object.assign(CONFIG, originalConfig);
    }
  }

  /**
   * Handle re_auth tool
   *
   * Performs a complete re-authentication:
   * 1. Closes all active browser sessions
   * 2. Deletes all saved authentication data (cookies, Chrome profile)
   * 3. Opens browser for fresh Google login
   *
   * Use for switching Google accounts or recovering from rate limits.
   */
  async handleReAuth(
    args: {
      show_browser?: boolean;
      browser_options?: BrowserOptions;
    },
    sendProgress?: ProgressCallback
  ): Promise<
    ToolResult<{
      status: string;
      message: string;
      authenticated: boolean;
      duration_seconds?: number;
    }> 
  > {
    const { show_browser, browser_options } = args;

    await sendProgress?.("Preparing re-authentication...", 0, 12);
    log.info(`🔧 [TOOL] re_auth called`);
    if (show_browser !== undefined) {
      log.info(`  Show browser: ${show_browser}`);
    }

    const startTime = Date.now();

    // Apply browser options temporarily
    const originalConfig = { ...CONFIG };
    const effectiveConfig = applyBrowserOptions(browser_options, show_browser);
    Object.assign(CONFIG, effectiveConfig);

    try {
      // 1. Close all active sessions
      await sendProgress?.("Closing all active sessions...", 1, 12);
      log.info("  🛑 Closing all sessions...");
      await this.sessionManager.closeAllSessions();
      log.success("  ✅ All sessions closed");

      // 2. Clear all auth data
      await sendProgress?.("Clearing authentication data...", 2, 12);
      log.info("  🗑️  Clearing all auth data...");
      await this.authManager.clearAllAuthData();
      log.success("  ✅ Auth data cleared");

      // 3. Perform fresh setup
      await sendProgress?.("Starting fresh authentication...", 3, 12);
      log.info("  🌐 Starting fresh authentication setup...");
      const success = await this.authManager.performSetup(sendProgress);

      const durationSeconds = (Date.now() - startTime) / 1000;

      if (success) {
        await sendProgress?.("Re-authentication complete!", 12, 12);
        log.success(`✅ [TOOL] re_auth completed (${durationSeconds.toFixed(1)}s)`);
        return {
          success: true,
          data: {
            status: "authenticated",
            message:
              "Successfully re-authenticated with new account. All previous sessions have been closed.",
            authenticated: true,
            duration_seconds: durationSeconds,
          },
        };
      } else {
        log.error(`❌ [TOOL] re_auth failed (${durationSeconds.toFixed(1)}s)`);
        return {
          success: false,
          error: "Re-authentication failed or was cancelled",
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const durationSeconds = (Date.now() - startTime) / 1000;
      log.error(
        `❌ [TOOL] re_auth failed: ${errorMessage} (${durationSeconds.toFixed(1)}s)`
      );
      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      // Restore original CONFIG
      Object.assign(CONFIG, originalConfig);
    }
  }

  /**
   * Handle add_notebook tool
   */
  async handleAddNotebook(args: AddNotebookInput): Promise<ToolResult<{ notebook: any }>> {
    log.info(`🔧 [TOOL] add_notebook called`);
    log.info(`  Name: ${args.name}`);

    try {
      const notebook = this.library.addNotebook(args);
      log.success(`✅ [TOOL] add_notebook completed: ${notebook.id}`);
      return {
        success: true,
        data: { notebook },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] add_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle list_notebooks tool
   */
  async handleListNotebooks(): Promise<ToolResult<{ notebooks: any[] }>> {
    log.info(`🔧 [TOOL] list_notebooks called`);

    try {
      const notebooks = this.library.listNotebooks();
      log.success(`✅ [TOOL] list_notebooks completed (${notebooks.length} notebooks)`);
      return {
        success: true,
        data: { notebooks },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] list_notebooks failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle get_notebook tool
   */
  async handleGetNotebook(args: { id: string }): Promise<ToolResult<{ notebook: any }>> {
    log.info(`🔧 [TOOL] get_notebook called`);
    log.info(`  ID: ${args.id}`);

    try {
      const notebook = this.library.getNotebook(args.id);
      if (!notebook) {
        log.warning(`⚠️  [TOOL] Notebook not found: ${args.id}`);
        return {
          success: false,
          error: `Notebook not found: ${args.id}`,
        };
      }

      log.success(`✅ [TOOL] get_notebook completed: ${notebook.name}`);
      return {
        success: true,
        data: { notebook },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] get_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle select_notebook tool
   */
  async handleSelectNotebook(args: { id: string }): Promise<ToolResult<{ notebook: any }>> {
    log.info(`🔧 [TOOL] select_notebook called`);
    log.info(`  ID: ${args.id}`);

    try {
      const notebook = this.library.selectNotebook(args.id);
      log.success(`✅ [TOOL] select_notebook completed: ${notebook.name}`);
      return {
        success: true,
        data: { notebook },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] select_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle update_notebook tool
   */
  async handleUpdateNotebook(args: UpdateNotebookInput): Promise<ToolResult<{ notebook: any }>> {
    log.info(`🔧 [TOOL] update_notebook called`);
    log.info(`  ID: ${args.id}`);

    try {
      const notebook = this.library.updateNotebook(args);
      log.success(`✅ [TOOL] update_notebook completed: ${notebook.name}`);
      return {
        success: true,
        data: { notebook },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] update_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle remove_notebook tool
   */
  async handleRemoveNotebook(args: { id: string }): Promise<ToolResult<{ removed: boolean; closed_sessions: number }>> {
    log.info(`🔧 [TOOL] remove_notebook called`);
    log.info(`  ID: ${args.id}`);

    try {
      const notebook = this.library.getNotebook(args.id);
      if (!notebook) {
        log.warning(`⚠️  [TOOL] Notebook not found: ${args.id}`);
        return {
          success: false,
          error: `Notebook not found: ${args.id}`,
        };
      }

      const removed = this.library.removeNotebook(args.id);
      if (removed) {
        const closedSessions = await this.sessionManager.closeSessionsForNotebook(
          notebook.url
        );
        log.success(`✅ [TOOL] remove_notebook completed`);
        return {
          success: true,
          data: { removed: true, closed_sessions: closedSessions },
        };
      } else {
        log.warning(`⚠️  [TOOL] Notebook not found: ${args.id}`);
        return {
          success: false,
          error: `Notebook not found: ${args.id}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] remove_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle search_notebooks tool
   */
  async handleSearchNotebooks(args: { query: string }): Promise<ToolResult<{ notebooks: any[] }>> {
    log.info(`🔧 [TOOL] search_notebooks called`);
    log.info(`  Query: "${args.query}"`);

    try {
      const notebooks = this.library.searchNotebooks(args.query);
      log.success(`✅ [TOOL] search_notebooks completed (${notebooks.length} results)`);
      return {
        success: true,
        data: { notebooks },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] search_notebooks failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle get_library_stats tool
   */
  async handleGetLibraryStats(): Promise<ToolResult<any>> {
    log.info(`🔧 [TOOL] get_library_stats called`);

    try {
      const stats = this.library.getStats();
      log.success(`✅ [TOOL] get_library_stats completed`);
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] get_library_stats failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle cleanup_data tool
   *
   * ULTRATHINK Deep Cleanup - scans entire system for ALL NotebookLM MCP files
   */
  async handleCleanupData(
    args: { confirm: boolean; preserve_library?: boolean }
  ): Promise<
    ToolResult<{
      status: string;
      mode: string;
      preview?: {
        categories: Array<{ name: string; description: string; paths: string[]; totalBytes: number; optional: boolean }>;
        totalPaths: number;
        totalSizeBytes: number;
      };
      result?: {
        deletedPaths: string[];
        failedPaths: string[];
        totalSizeBytes: number;
        categorySummary: Record<string, { count: number; bytes: number }>;
      };
    }> 
  > {
    const { confirm, preserve_library = false } = args;

    log.info(`🔧 [TOOL] cleanup_data called`);
    log.info(`  Confirm: ${confirm}`);
    log.info(`  Preserve Library: ${preserve_library}`);

    const cleanupManager = new CleanupManager();

    try {
      // Always run in deep mode
      const mode = "deep";

      if (!confirm) {
        // Preview mode - show what would be deleted
        log.info(`  📋 Generating cleanup preview (mode: ${mode})...`);

        const preview = await cleanupManager.getCleanupPaths(mode, preserve_library);
        const platformInfo = cleanupManager.getPlatformInfo();

        log.info(`  Found ${preview.totalPaths.length} items (${cleanupManager.formatBytes(preview.totalSizeBytes)})`);
        log.info(`  Platform: ${platformInfo.platform}`);

        return {
          success: true,
          data: {
            status: "preview",
            mode,
            preview: {
              categories: preview.categories,
              totalPaths: preview.totalPaths.length,
              totalSizeBytes: preview.totalSizeBytes,
            },
          },
        };
      } else {
        // Cleanup mode - actually delete files
        log.info(`  🗑️  Performing cleanup (mode: ${mode})...`);

        const result = await cleanupManager.performCleanup(mode, preserve_library);

        if (result.success) {
          log.success(`✅ [TOOL] cleanup_data completed - deleted ${result.deletedPaths.length} items`);
        } else {
          log.warning(`⚠️  [TOOL] cleanup_data completed with ${result.failedPaths.length} errors`);
        }

        return {
          success: result.success,
          data: {
            status: result.success ? "completed" : "partial",
            mode,
            result: {
              deletedPaths: result.deletedPaths,
              failedPaths: result.failedPaths,
              totalSizeBytes: result.totalSizeBytes,
              categorySummary: result.categorySummary,
            },
          },
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] cleanup_data failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Cleanup all resources (called on server shutdown)
   */
  async cleanup(): Promise<void> {
    log.info(`🧹 Cleaning up tool handlers...`);
    await this.sessionManager.closeAllSessions();
    log.success(`✅ Tool handlers cleanup complete`);
  }
}
