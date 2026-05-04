/**
 * Verbose logging utilities for debugging CLI operations
 */

export interface LoggerConfig {
  verbose: boolean;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2).split("\n").join("\n    ");
  }
  return String(value);
}

export class Logger {
  constructor(private config: LoggerConfig) {}

  /**
   * Progress chatter goes to stderr — keeps stdout clean for the
   * actual data each command emits, and prevents pollution when
   * `bnd node --mcp` uses stdio for JSON-RPC.
   */

  /** Log HTTP request being made */
  http(method: string, url: string): void {
    if (!this.config.verbose) return;
    console.error(`  → ${method} ${url}`);
  }

  /** Log important info (connection, results, etc) */
  info(message: string): void {
    if (!this.config.verbose) return;
    console.error(`  ℹ ${message}`);
  }

  /** Log detailed data structures */
  data(label: string, value: unknown): void {
    if (!this.config.verbose) return;
    console.error(`  ${label}:`);
    console.error(`    ${formatValue(value)}`);
  }

  error(message: string): void {
    // Errors always show, regardless of verbose
    console.error(`  ✗ ${message}`);
  }

  section(name: string): void {
    if (!this.config.verbose) return;
    console.error(`\n${"─".repeat(60)}`);
    console.error(`  ${name}`);
    console.error(`${"─".repeat(60)}`);
  }
}

export function createLogger(verbose: boolean): Logger {
  return new Logger({ verbose });
}
