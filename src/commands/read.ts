/**
 * `bnd read` — read one or more URIs through the configured rig.
 *
 *   bnd read <uri> [<uri>...]    # batch read
 *   bnd read <uri>/              # trailing slash → list children (rig native)
 *   bnd read <uri> --json        # raw JSON for piping
 */

import { loadConfig } from "../config.ts";
import { loadRig } from "../rig-loader.ts";
import { createLogger } from "../logger.ts";

interface ReadResultShape {
  success?: boolean;
  uri?: string;
  record?: { data?: unknown };
  error?: string;
}

export async function read(opts: {
  uris: string[];
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

  const handle = (rig as unknown as {
    read: (u: string[]) => Promise<ReadResultShape[]>;
  }).read(opts.uris);
  const results = await handle;

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    if (results.some((r) => r.success === false)) Deno.exit(1);
    return;
  }

  let failed = 0;
  for (const r of results) {
    if (r.success === false) {
      console.error(`✗ ${r.uri ?? "?"} — ${r.error ?? "not found"}`);
      failed++;
      continue;
    }
    const data = r.record?.data;
    const rendered = typeof data === "string"
      ? data
      : JSON.stringify(data, null, 2);
    const indented = rendered.split("\n").map((l) => `  ${l}`).join("\n");
    console.log(`${r.uri ?? "?"}:`);
    console.log(indented);
  }
  if (failed > 0) Deno.exit(1);
}
