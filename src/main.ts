#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import {
  configEdit,
  configInit,
  configSetRig,
  configShow,
} from "./commands/config.ts";
import { receive, send } from "./commands/send.ts";
import { status } from "./commands/status.ts";
import { read } from "./commands/read.ts";
import { observe } from "./commands/observe.ts";
import { node } from "./commands/node.ts";

const HELP = `bnd — B3nd CLI (v0.3)

A thin framework tool. Loads a user-defined rig module and uses it
to send / read / observe / serve. No protocol or signing concerns —
those belong in your rig module.

Commands:
  bnd send <file|->                Send ready outputs (rig.send)
  bnd receive <file|->             Ingest ready outputs (rig.receive)
  bnd read <uri> [<uri>...]        Read URIs (trailing slash → list)
  bnd observe <pattern>            Subscribe to URI pattern (Ctrl+C to stop)
  bnd status                       Show resolved rig health
  bnd node [<rig>]                 Host the rig over HTTP/gRPC/MCP
                                   Flags: --http[=port] --grpc[=port] --mcp
                                          --cors '*' --watch

Config:
  bnd config                       Show current config + resolved rig
  bnd config init [<path>]         Scaffold a starter b3nd.rig.ts
  bnd config rig <path|url>        Set the default rig
  bnd config edit                  Open the resolved rig in $EDITOR

Universal flags (work on any command):
  -v, --verbose                    Verbose progress to stderr
  --rig <path|url>                 Override the resolved rig for this run
  --json                           Machine-friendly output (NDJSON for observe,
                                   JSON array for read)

Rig resolution order:
  1. --rig <path|url>
  2. ./b3nd.rig.ts in current directory
  3. rig = "..." in ~/.bnd/config.toml

Quickstart:
  bnd config init
  bnd config edit                  # point your rig at a real node
  bnd status
`;

function showHelp(): void {
  console.log(HELP);
}

/**
 * Parse universal flags. Strips them from args and returns the rest as
 * positional. Anywhere-in-argv: -v/--verbose, --rig <x>, --json.
 */
interface ParsedFlags {
  args: string[];
  verbose: boolean;
  json: boolean;
  rig?: string;
}

function parseFlags(args: string[]): ParsedFlags {
  let verbose = false;
  let json = false;
  let rig: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-v" || a === "--verbose") verbose = true;
    else if (a === "--json") json = true;
    else if (a === "--rig" && args[i + 1] !== undefined) rig = args[++i];
    else positional.push(a);
  }
  return { args: positional, verbose, json, rig };
}

async function main(): Promise<void> {
  const args = Deno.args;

  if (args.length === 0) {
    showHelp();
    return;
  }

  const {
    args: cleanArgs,
    verbose,
    json,
    rig: rigOverride,
  } = parseFlags(args);
  const command = cleanArgs[0];
  const subcommand = cleanArgs[1];

  try {
    switch (command) {
      case "send": {
        if (!cleanArgs[1]) throw new Error("Usage: bnd send <file|->");
        await send({ source: cleanArgs[1], rig: rigOverride, verbose });
        break;
      }

      case "receive": {
        if (!cleanArgs[1]) throw new Error("Usage: bnd receive <file|->");
        await receive({ source: cleanArgs[1], rig: rigOverride, verbose });
        break;
      }

      case "read": {
        if (cleanArgs.length < 2) {
          throw new Error("Usage: bnd read <uri> [<uri>...]");
        }
        await read({
          uris: cleanArgs.slice(1),
          rig: rigOverride,
          json,
          verbose,
        });
        break;
      }

      case "observe": {
        if (!cleanArgs[1]) throw new Error("Usage: bnd observe <pattern>");
        await observe({
          pattern: cleanArgs[1],
          rig: rigOverride,
          json,
          verbose,
        });
        break;
      }

      case "status": {
        await status({ rig: rigOverride, verbose });
        break;
      }

      case "node": {
        await node({
          rig: rigOverride,
          verbose,
          args: cleanArgs.slice(1),
        });
        break;
      }

      case "config": {
        if (!subcommand || subcommand === "show") {
          await configShow();
        } else if (subcommand === "rig") {
          if (!cleanArgs[2]) {
            throw new Error("Path required. Usage: bnd config rig <path|url>");
          }
          await configSetRig(cleanArgs[2]);
        } else if (subcommand === "edit") {
          await configEdit();
        } else if (subcommand === "init") {
          await configInit(cleanArgs[2]);
        } else {
          throw new Error(`Unknown config subcommand: ${subcommand}`);
        }
        break;
      }

      case "help":
      case "-h":
      case "--help": {
        showHelp();
        break;
      }

      default:
        throw new Error(
          `Unknown command: ${command}\nRun \`bnd help\` for usage.`,
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Error: ${message}`);
    Deno.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ Fatal error: ${message}`);
  Deno.exit(1);
});
