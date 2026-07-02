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
import { VERSION } from "./version.ts";

const HELP = `bnd — B3nd CLI (v${VERSION})

A thin framework tool. Loads a user-defined rig module and uses it
to send / read / observe / serve. No protocol or signing concerns —
those belong in your rig module.

Commands:
  bnd send <file|->                Push outputs out through the rig (rig.send)
  bnd receive <file|->             Ingest outputs into the rig (rig.receive)
  bnd read <uri> [<uri>...]        Read locators
  bnd observe <pattern>            Subscribe to URI pattern (Ctrl+C to stop)
  bnd status                       Show resolved rig health
  bnd node [<rig>]                 Host the rig over HTTP/WS/gRPC/MCP
                                   Flags: --http[=port] --ws[=port] --grpc[=port]
                                          --mcp --mcp-http[=port] --mcp-ws[=port]
                                          --cors '*' --watch

Config:
  bnd config                       Show current config + resolved rig
  bnd config init [<path>]         Scaffold a starter b3nd.rig.ts
  bnd config rig <path|url>        Set the default rig
  bnd config edit                  Open the resolved rig in $EDITOR

Universal flags (work on any command):
  -v, --verbose                    Verbose progress to stderr
  -h, --help                       Print help for the current command
  --rig <path|url>                 Override the resolved rig for this run
  --json                           Machine-friendly output (NDJSON for observe,
                                   JSON array for read)
  -V, --version                    Print version and exit

Rig resolution order:
  1. --rig <path|url>
  2. ./b3nd.rig.ts in current directory
  3. rig = "..." in ~/.bnd/config.toml

Quickstart:
  bnd config init
  bnd config edit                  # point your rig at a real node
  bnd status
`;

/** Per-command help strings sourced from each command's doc comment. */
const COMMAND_HELP: Record<string, string> = {
  send: `Usage: bnd send <file|->

  Push outputs out through the rig (rig.send).

  The source may be:
    <file>   JSON file: a [string, any] tuple or array of tuples
    -        stdin: auto-detects NDJSON streaming vs single-JSON
             (pipe-friendly: bnd observe --json | bnd send -)

  Flags:
    -v, --verbose    Verbose progress to stderr
    --rig <path>     Override the resolved rig for this run`,

  receive: `Usage: bnd receive <file|->

  Ingest outputs into the rig (rig.receive).

  The source format is identical to \`bnd send\`. Symmetric with send:
  pipe \`bnd observe --json\` into \`bnd receive -\` to forward live events.

  Flags:
    -v, --verbose    Verbose progress to stderr
    --rig <path>     Override the resolved rig for this run`,

  read: `Usage: bnd read <uri> [<uri>...]

  Read one or more locators from the rig.

  Flags:
    -v, --verbose    Verbose progress to stderr
    --rig <path>     Override the resolved rig for this run
    --json           Output a JSON array instead of pretty text`,

  observe: `Usage: bnd observe <pattern>

  Subscribe to a URI pattern (Ctrl+C to stop).

  Flags:
    -v, --verbose    Verbose progress to stderr
    --rig <path>     Override the resolved rig for this run
    --json           NDJSON streaming output`,

  status: `Usage: bnd status

  Show resolved rig health (calls rig.status if available).

  Flags:
    -v, --verbose    Verbose progress to stderr
    --rig <path>     Override the resolved rig for this run`,

  node: `Usage: bnd node [<rig>]

  Host the resolved rig over one or more transports.

  Transport flags (at least one required; defaults to --http):
    --http[=port]            HTTP API on :3000
    --ws[=port]              WebSocket API on :8080
    --grpc[=port]            gRPC-over-HTTP on :50051
    --mcp                    MCP over stdio (exits when client disconnects)
    --mcp-http[=port]        MCP over Streamable HTTP on :3001
    --mcp-ws[=port]          MCP over WebSocket on :8081

  Other flags:
    --cors '<origin>'        CORS wrapper for HTTP transports
    --watch                  Restart on rig file change
    -v, --verbose            Verbose progress to stderr
    --rig <path>             Override the resolved rig for this run`,

  config:
    `Usage: bnd config [show]            Show current config + resolved rig
       bnd config init [<path>]       Scaffold a starter b3nd.rig.ts
       bnd config rig <path|url>      Set the default rig
       bnd config edit                Open the resolved rig in $EDITOR`,
};

function showHelp(): void {
  console.log(HELP);
}

/**
 * Parse universal flags. Strips them from args and returns the rest as
 * positional. Anywhere-in-argv: -v/--verbose, --rig <x>, --json,
 * -h/--help, -V/--version.
 */
interface ParsedFlags {
  args: string[];
  verbose: boolean;
  json: boolean;
  rig?: string;
  help: boolean;
  version: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
  let verbose = false;
  let json = false;
  let rig: string | undefined;
  let help = false;
  let version = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-v" || a === "--verbose") verbose = true;
    else if (a === "--json") json = true;
    else if (a === "--rig" && args[i + 1] !== undefined) rig = args[++i];
    else if (a === "-h" || a === "--help") help = true;
    else if (a === "-V" || a === "--version") version = true;
    else positional.push(a);
  }
  return { args: positional, verbose, json, rig, help, version };
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
    help,
    version,
  } = parseFlags(args);

  // --version / -V: print version and exit. Safe, no rig required.
  if (version) {
    console.log(`bnd ${VERSION}`);
    return;
  }

  const command = cleanArgs[0];
  const subcommand = cleanArgs[1];

  // -h / --help anywhere, or `bnd help [<cmd>]`: print help and exit.
  // Safe: must never touch the rig or require a rig to be configured.
  if (help || command === "help") {
    // Determine which command the user wants help for:
    //   bnd send --help  → help=true,  command="send"
    //   bnd help send    → help=false, command="help", subcommand="send"
    //   bnd --help       → help=true,  command=undefined
    //   bnd help         → help=false, command="help", subcommand=undefined
    const helpCmd = help ? command : subcommand;
    if (helpCmd && COMMAND_HELP[helpCmd]) {
      console.log(COMMAND_HELP[helpCmd]);
    } else {
      showHelp();
    }
    return;
  }

  // No command after stripping flags (e.g. `bnd --json`).
  if (!command) {
    showHelp();
    return;
  }

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
