/**
 * `bnd send` — push ready outputs through the configured rig.
 *
 *   bnd send <file>     # JSON: [string, any] or [string, any][]
 *   bnd send -          # read JSON from stdin
 */

import { loadConfig } from "../config.ts";
import { loadRig } from "../rig-loader.ts";
import { readOutputs } from "../io.ts";
import { createLogger } from "../logger.ts";

interface ResultShape {
  accepted?: boolean;
  uri?: string;
  error?: string;
}

export async function send(opts: {
  source: string;
  rig?: string;
  verbose?: boolean;
}): Promise<void> {
  await dispatch("send", opts);
}

export async function receive(opts: {
  source: string;
  rig?: string;
  verbose?: boolean;
}): Promise<void> {
  await dispatch("receive", opts);
}

async function dispatch(
  method: "send" | "receive",
  opts: { source: string; rig?: string; verbose?: boolean },
): Promise<void> {
  const logger = createLogger(opts.verbose ?? false);
  const outputs = await readOutputs(opts.source);
  logger.info(`Loaded ${outputs.length} output(s) from ${opts.source}`);

  const config = await loadConfig();
  const { rig, source } = await loadRig({
    explicit: opts.rig,
    configRig: config.rig,
  });
  logger.info(`Rig: ${source.input} (${source.origin})`);

  const handle = (rig as unknown as Record<string, (o: unknown[]) => unknown>)[
    method
  ](outputs);
  const results = (await handle) as ResultShape[];

  let failed = 0;
  for (const r of results) {
    const uri = r.uri ?? "?";
    if (r.accepted) {
      console.log(`✓ ${uri}`);
    } else {
      console.error(`✗ ${uri} — ${r.error ?? "rejected"}`);
      failed++;
    }
  }
  if (failed > 0) Deno.exit(1);
}
