/**
 * `bnd observe` — subscribe to a URI pattern via the configured rig.
 *
 *   bnd observe <pattern>
 *   bnd observe <pattern> --json     # NDJSON for piping (jq, awk, etc.)
 *
 * Ctrl+C aborts the subscription cleanly. For transformations, pipe
 * the --json output through your tool of choice.
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
    observe: (p: string, signal: AbortSignal) => AsyncIterable<unknown>;
  }).observe(opts.pattern, ctrl.signal);

  try {
    for await (const value of stream) {
      console.log(render(value, opts.json ?? false));
    }
  } catch (e) {
    if (ctrl.signal.aborted) return; // clean Ctrl+C exit
    throw e;
  } finally {
    Deno.removeSignalListener("SIGINT", onSignal);
  }
}

function render(value: unknown, json: boolean): string {
  if (typeof value === "string") return value;
  return json ? JSON.stringify(value) : JSON.stringify(value, null, 2);
}
