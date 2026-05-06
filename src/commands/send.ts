/**
 * `bnd send` / `bnd receive` — push ready outputs through the configured rig.
 *
 *   bnd send <file>     # JSON file: [string, any] or [string, any][]
 *   bnd send -          # stdin: auto-detects NDJSON streaming vs single-JSON
 *   bnd receive ...     # symmetric, calls rig.receive instead of rig.send
 *
 * For stdin, NDJSON is detected by attempting to parse the first
 * non-empty line as standalone JSON. If it parses, each line is sent
 * as it arrives — pipe-friendly for `bnd observe --json | bnd receive -`.
 */

import { loadConfig } from "../config.ts";
import { loadRig } from "../rig-loader.ts";
import { streamOutputs } from "../io.ts";
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

  const config = await loadConfig();
  const { rig, source } = await loadRig({
    explicit: opts.rig,
    configRig: config.rig,
  });
  logger.info(`Rig: ${source.input} (${source.origin})`);

  // Call via the rig directly so `this` is bound — `rig.send` / `rig.receive`
  // depend on private state (`_pipeline`) which is unreachable when the
  // method is destructured into a free variable.
  const dispatchTo = rig as unknown as Record<
    string,
    (this: unknown, o: unknown[]) => unknown
  >;

  let total = 0;
  let failed = 0;

  for await (const batch of streamOutputs(opts.source)) {
    total += batch.length;
    const results =
      (await dispatchTo[method].call(rig, batch)) as ResultShape[];
    for (const r of results) {
      const uri = r.uri ?? "?";
      if (r.accepted) {
        console.log(`✓ ${uri}`);
      } else {
        console.error(`✗ ${uri} — ${r.error ?? "rejected"}`);
        failed++;
      }
    }
  }

  logger.info(`${total} output(s) total, ${failed} failed`);
  if (failed > 0) Deno.exit(1);
}
