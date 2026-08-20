/**
 * Server core: manager construction and MCP request handler wiring.
 *
 * Extracted from index.ts so multiple transports (stdio direct mode, a
 * singleton backend, per-client proxies) can share one set of managers
 * and tool/resource handlers within a single process.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { AuthManager } from "./auth/auth-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { NotebookLibrary } from "./library/notebook-library.js";
import { ToolHandlers, buildToolDefinitions } from "./tools/index.js";
import { ResourceHandlers } from "./resources/resource-handlers.js";
import { SettingsManager } from "./utils/settings-manager.js";
import { SERVER_VERSION } from "./config.js";
import { log } from "./utils/logger.js";

/**
 * Shared server core: the managers, handlers and tool definitions that are
 * instantiated once per process and reused across MCP `Server` instances.
 */
export interface ServerCore {
  authManager: AuthManager;
  sessionManager: SessionManager;
  library: NotebookLibrary;
  settingsManager: SettingsManager;
  toolHandlers: ToolHandlers;
  resourceHandlers: ResourceHandlers;
  toolDefinitions: Tool[];
}

/**
 * Instantiate all managers and handlers exactly once per process.
 */
export function createServerCore(): ServerCore {
  // Initialize managers
  const authManager = new AuthManager();
  const sessionManager = new SessionManager(authManager);
  const library = new NotebookLibrary();
  const settingsManager = new SettingsManager();

  // Initialize handlers
  const toolHandlers = new ToolHandlers(sessionManager, authManager, library);
  const resourceHandlers = new ResourceHandlers(library);

  // Build and Filter tool definitions
  const allTools = buildToolDefinitions(library) as Tool[];
  const toolDefinitions = settingsManager.filterTools(allTools);

  const activeSettings = settingsManager.getEffectiveSettings();
  log.info("🚀 NotebookLM MCP Server initialized");
  log.info(`  Version: ${SERVER_VERSION}`);
  log.info(`  Node: ${process.version}`);
  log.info(`  Platform: ${process.platform}`);
  log.info(`  Profile: ${activeSettings.profile} (${toolDefinitions.length} tools active)`);

  return {
    authManager,
    sessionManager,
    library,
    settingsManager,
    toolHandlers,
    resourceHandlers,
    toolDefinitions,
  };
}

/**
 * Create a fresh MCP `Server` wired to the shared core. The caller is
 * responsible for connecting it to a transport.
 */
export function createMcpServer(core: ServerCore): Server {
  const server = new Server(
    {
      name: "notebooklm-mcp",
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        // Declare only what this server actually implements. Two entries
        // were removed on 2026-08-19:
        // - resourceTemplates: not a capability at all. ServerCapabilities
        //   allows experimental, logging, completions, prompts, resources,
        //   tools and tasks; the key passed only because the schema is loose.
        // - logging: never used here, and deprecated by the 2026-07-28 spec.
        //   Declaring it invited requests this server cannot answer.
        tools: {},
        resources: {},
        prompts: {},
        completions: {}, // Required for completion/complete support
      },
    }
  );

  // Register Resource Handlers (Resources, Templates, Completions)
  core.resourceHandlers.registerHandlers(server);

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log.info("📋 [MCP] list_tools request received");
    return {
      tools: core.toolDefinitions,
    };
  });

  // Prompts capability is declared at init, so these handlers must exist
  // (clients like Claude Desktop call prompts/list and got -32601 before).
  const prompts = [
    {
      name: "notebooklm.auth-setup",
      description: "First-time Google login for NotebookLM access",
      text:
        "Run the setup_auth tool (show_browser=true). A browser window opens: " +
        "ask the user to complete the Google login within 10 minutes, " +
        "then verify with get_health that authenticated is true.",
    },
    {
      name: "notebooklm.auth-repair",
      description: "Recover from expired or failing NotebookLM authentication",
      text:
        "Authentication is failing. Proceed in order: " +
        "1) get_health to inspect the current state. " +
        "2) If authenticated=false, run setup_auth (show_browser=true) and let the user complete the login. " +
        "The persistent profile is reused, so this is often a one-click re-selection. " +
        "3) If the browser fails to launch and get_health reports chrome_running=true, ask the user to close " +
        "Chrome windows left from previous automation runs, then retry. " +
        "4) Only as a last resort, and after telling the user it wipes cookies and browser profile, " +
        "propose cleanup_data (the notebook library is preserved).",
    },
  ];

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    log.info("💬 [MCP] list_prompts request received");
    return {
      prompts: prompts.map(({ name, description }) => ({ name, description })),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = prompts.find((p) => p.name === request.params.name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }
    return {
      description: prompt.description,
      messages: [{ role: "user", content: { type: "text", text: prompt.text } }],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const progressToken = (args as any)?._meta?.progressToken;

    log.info(`🔧 [MCP] Tool call: ${name}`);
    if (progressToken) {
      log.info(`  📊 Progress token: ${progressToken}`);
    }

    // Create progress callback function
    const sendProgress = async (message: string, progress?: number, total?: number) => {
      if (progressToken) {
        await server.notification({
          method: "notifications/progress",
          params: {
            progressToken,
            message,
            ...(progress !== undefined && { progress }),
            ...(total !== undefined && { total }),
          },
        });
        log.dim(`  📊 Progress: ${message}`);
      }
    };

    try {
      let result;

      switch (name) {
        case "ask_question":
          result = await core.toolHandlers.handleAskQuestion(
            args as {
              question: string;
              session_id?: string;
              notebook_id?: string;
              notebook_url?: string;
              show_browser?: boolean;
            },
            sendProgress
          );
          break;

        case "add_notebook":
          result = await core.toolHandlers.handleAddNotebook(
            args as {
              url: string;
              name: string;
              description: string;
              topics: string[];
              content_types?: string[];
              use_cases?: string[];
              tags?: string[];
            }
          );
          break;

        case "list_notebooks":
          result = await core.toolHandlers.handleListNotebooks();
          break;

        case "get_notebook":
          result = await core.toolHandlers.handleGetNotebook(
            args as { id: string }
          );
          break;

        case "select_notebook":
          result = await core.toolHandlers.handleSelectNotebook(
            args as { id: string }
          );
          break;

        case "update_notebook":
          result = await core.toolHandlers.handleUpdateNotebook(
            args as {
              id: string;
              name?: string;
              description?: string;
              topics?: string[];
              content_types?: string[];
              use_cases?: string[];
              tags?: string[];
              url?: string;
            }
          );
          break;

        case "remove_notebook":
          result = await core.toolHandlers.handleRemoveNotebook(
            args as { id: string }
          );
          break;

        case "search_notebooks":
          result = await core.toolHandlers.handleSearchNotebooks(
            args as { query: string }
          );
          break;

        case "get_library_stats":
          result = await core.toolHandlers.handleGetLibraryStats();
          break;

        case "list_sessions":
          result = await core.toolHandlers.handleListSessions();
          break;

        case "close_session":
          result = await core.toolHandlers.handleCloseSession(
            args as { session_id: string }
          );
          break;

        case "reset_session":
          result = await core.toolHandlers.handleResetSession(
            args as { session_id: string },
            sendProgress
          );
          break;

        case "get_health":
          result = await core.toolHandlers.handleGetHealth();
          break;

        case "setup_auth":
          result = await core.toolHandlers.handleSetupAuth(
            args as { show_browser?: boolean },
            sendProgress
          );
          break;

        case "re_auth":
          result = await core.toolHandlers.handleReAuth(
            args as { show_browser?: boolean },
            sendProgress
          );
          break;

        case "cleanup_data":
          result = await core.toolHandlers.handleCleanupData(
            args as { confirm: boolean }
          );
          break;

        default:
          log.error(`❌ [MCP] Unknown tool: ${name}`);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Unknown tool: ${name}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
      }

      // Return result
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [MCP] Tool execution error: ${errorMessage}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: errorMessage,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  });

  return server;
}
