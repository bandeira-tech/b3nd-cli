/**
 * `bnd status` — show the resolved rig's health and capabilities.
 */

import { loadConfig } from "../config.ts";
import { loadRig } from "../rig-loader.ts";
import { createLogger } from "../logger.ts";

interface StatusShape {
  status?: string;
  message?: string;
  details?: Record<string, unknown>;
  schema?: unknown;
}

export async function status(opts: {
  rig?: string;
  verbose?: boolean;
}): Promise<void> {
  const logger = createLogger(opts.verbose ?? false);
  const config = await loadConfig();

  const { rig, source } = await loadRig({
    explicit: opts.rig,
    configRig: config.rig,
  });
  logger.info(`Rig: ${source.input} (${source.origin})`);

  const result = await (rig as unknown as {
    status: () => Promise<StatusShape>;
  }).status();

  const icon = result.status === "healthy"
    ? "✓"
    : result.status === "degraded"
    ? "~"
    : "✗";
  console.log(`${icon} ${result.status ?? "unknown"}`);

  if (result.message) console.log(`  ${result.message}`);

  if (result.details && Object.keys(result.details).length > 0) {
    console.log("  details:");
    for (const [k, v] of Object.entries(result.details)) {
      const rendered = typeof v === "object" ? JSON.stringify(v) : String(v);
      console.log(`    ${k}: ${rendered}`);
    }
  }

  if (
    result.schema && Array.isArray(result.schema) && result.schema.length > 0
  ) {
    console.log("  schema:");
    for (const s of result.schema) console.log(`    - ${s}`);
  }
}
