/**
 * `bnd read` — read one or more locators through the configured rig.
 *
 *   bnd read <uri> [<uri>...]    # batch read
 *   bnd read <uri>/              # trailing slash → listing (client-defined)
 *   bnd read <uri> --json        # raw JSON for piping
 *
 * The rig returns one `Output<T>` per input — `[locator, payload]`. The
 * payload's shape is the executing client's concern; the CLI renders it
 * verbatim. What "miss" looks like, what a listing yields, what an
 * extension function returns — all up to the client. The CLI's only job
 * is to surface the bytes the client produced.
 */

import { loadConfig } from "../config.ts";
import { loadRig } from "../rig-loader.ts";
import { createLogger } from "../logger.ts";

type Output<T = unknown> = [string, T];

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

  const outputs = await (rig as unknown as {
    read: (u: string[]) => Promise<Output[]>;
  }).read(opts.uris);

  if (opts.json) {
    console.log(JSON.stringify(outputs, null, 2));
    return;
  }

  for (const [uri, payload] of outputs) {
    const rendered = typeof payload === "string"
      ? payload
      : JSON.stringify(payload, null, 2);
    const indented = rendered.split("\n").map((l) => `  ${l}`).join("\n");
    console.log(`${uri}:`);
    console.log(indented);
  }
}
