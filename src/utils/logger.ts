/**
 * Console logging utilities with colors and formatting
 * Similar to Python's rich.console
 *
 * Supports dependency injection for testing:
 * - Use createLogger() to create a custom logger instance
 * - Use setGlobalLogger() to replace the global logger
 * - Use resetGlobalLogger() to restore the default logger
 */

type LogLevel = "info" | "success" | "warning" | "error" | "debug" | "dim";

interface LogStyle {
  prefix: string;
  color: string;
}

const STYLES: Record<LogLevel, LogStyle> = {
  info: { prefix: "ℹ️", color: "\x1b[36m" }, // Cyan
  success: { prefix: "✅", color: "\x1b[32m" }, // Green
  warning: { prefix: "⚠️", color: "\x1b[33m" }, // Yellow
  error: { prefix: "❌", color: "\x1b[31m" }, // Red
  debug: { prefix: "🔍", color: "\x1b[35m" }, // Magenta
  dim: { prefix: "  ", color: "\x1b[2m" }, // Dim
};

const RESET = "\x1b[0m";

/**
 * Logger interface for dependency injection
 */
export interface ILogger {
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  dim(message: string): void;
  setEnabled(enabled: boolean): void;
}

/**
 * Logger class for consistent console output
 */
export class Logger implements ILogger {
  private enabled: boolean;
  private outputFn: (message: string) => void;

  constructor(enabled: boolean = true, outputFn?: (message: string) => void) {
    this.enabled = enabled;
    // Default: use stderr to keep stdout clean for MCP JSON-RPC
    this.outputFn = outputFn ?? ((msg) => console.error(msg));
  }

  /**
   * Log a message with a specific style
   */
  log(message: string, level: LogLevel = "info"): void {
    if (!this.enabled) return;

    const style = STYLES[level];
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
    const formattedMessage = `${style.color}${style.prefix}  [${timestamp}] ${message}${RESET}`;

    this.outputFn(formattedMessage);
  }

  info(message: string): void {
    this.log(message, "info");
  }

  success(message: string): void {
    this.log(message, "success");
  }

  warning(message: string): void {
    this.log(message, "warning");
  }

  error(message: string): void {
    this.log(message, "error");
  }

  debug(message: string): void {
    this.log(message, "debug");
  }

  dim(message: string): void {
    this.log(message, "dim");
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

/**
 * Create a new logger instance (useful for testing)
 *
 * @param enabled Whether logging is enabled
 * @param outputFn Custom output function (defaults to console.error)
 */
export function createLogger(
  enabled: boolean = true,
  outputFn?: (message: string) => void
): ILogger {
  return new Logger(enabled, outputFn);
}

/**
 * Create a silent logger that captures messages (for testing)
 */
export function createTestLogger(): ILogger & { messages: string[] } {
  const messages: string[] = [];
  const logger = new Logger(true, (msg) => messages.push(msg));
  return Object.assign(logger, { messages });
}

// Default global logger instance
let globalLogger: ILogger = new Logger();

/**
 * Set the global logger instance (for dependency injection)
 */
export function setGlobalLogger(newLogger: ILogger): void {
  globalLogger = newLogger;
}

/**
 * Reset the global logger to the default instance
 */
export function resetGlobalLogger(): void {
  globalLogger = new Logger();
}

/**
 * Global logger instance (legacy export for backward compatibility)
 */
export const logger = globalLogger;

/**
 * Convenience functions for quick logging
 * Uses the current global logger instance
 */
export const log = {
  info: (msg: string) => globalLogger.info(msg),
  success: (msg: string) => globalLogger.success(msg),
  warning: (msg: string) => globalLogger.warning(msg),
  error: (msg: string) => globalLogger.error(msg),
  debug: (msg: string) => globalLogger.debug(msg),
  dim: (msg: string) => globalLogger.dim(msg),
};
