/**
 * `bnd observe` — subscribe to URI patterns via the configured rig.
 *
 *   bnd observe <pattern>
 *   bnd observe <pattern> --json     # NDJSON for piping (jq, awk, etc.)
 *
 * The rig yields batches of fired URIs (`readonly string[]`). Each URI
 * in each batch becomes one line — plain text by default, JSON-encoded
 * string under `--json`. Ctrl+C aborts the subscription cleanly.
 */

import { loadConfig } from "../config.ts";
import { loadRig } from "../rig-loader.ts";
import { createLogger } from "../logger.ts";

export async function observe(opts: {
  pattern: string;
  rig?: string;
  json?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const logger = createLogger(opts.verbose ?? false);
  const config = await loadConfig();

  const { rig, source } = await loadRig({
    explicit: opts.rig,
    configRig: config.rig,
  });
  logger.info(`Rig: ${source.input} (${source.origin})`);

  const ctrl = new AbortController();
  const onSignal = () => ctrl.abort();
  Deno.addSignalListener("SIGINT", onSignal);

  const stream = (rig as unknown as {
    observe: (
      urls: string[],
      signal: AbortSignal,
    ) => AsyncIterable<readonly string[]>;
  }).observe([opts.pattern], ctrl.signal);

  try {
    for await (const batch of stream) {
      for (const uri of batch) {
        console.log(opts.json ? JSON.stringify(uri) : uri);
      }
    }
  } catch (e) {
    if (ctrl.signal.aborted) return; // clean Ctrl+C exit
    throw e;
  } finally {
    Deno.removeSignalListener("SIGINT", onSignal);
  }
}
