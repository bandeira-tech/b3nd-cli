#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import {
  accountCreate,
  confAccount,
  confEncrypt,
  confNode,
  del,
  deploy,
  encryptCreate,
  health,
  serverKeysEnv,
  showHelp,
  upload,
} from "./commands.ts";
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
import {
  nodeConfigGet,
  nodeConfigPush,
  nodeEnv,
  nodeKeygen,
  nodeStatus,
} from "./commands/node.ts";
import { networkCreate, networkStatus, networkUp } from "./commands/network.ts";

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

/**
 * Main CLI entry point
 */
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
      case "account": {
        if (!subcommand) {
          throw new Error("Subcommand required. Usage: bnd account <create>");
        }

        if (subcommand === "create") {
          await accountCreate(cleanArgs[2]);
        } else {
          throw new Error(`Unknown account subcommand: ${subcommand}`);
        }
        break;
      }

      case "encrypt": {
        if (!subcommand) {
          throw new Error("Subcommand required. Usage: bnd encrypt <create>");
        }

        if (subcommand === "create") {
          await encryptCreate(cleanArgs[2]);
        } else {
          throw new Error(`Unknown encrypt subcommand: ${subcommand}`);
        }
        break;
      }

      case "conf": {
        if (!subcommand) {
          throw new Error(
            "Subcommand required. Usage: bnd conf <node|account|encrypt> <value>",
          );
        }

        if (subcommand === "node") {
          if (!cleanArgs[2]) {
            throw new Error("Node URL required. Usage: bnd conf node <url>");
          }
          await confNode(cleanArgs[2]);
        } else if (subcommand === "account") {
          if (!cleanArgs[2]) {
            throw new Error(
              "Account key path required. Usage: bnd conf account <path>",
            );
          }
          await confAccount(cleanArgs[2]);
        } else if (subcommand === "encrypt") {
          if (!cleanArgs[2]) {
            throw new Error(
              "Encryption key path required. Usage: bnd conf encrypt <path>",
            );
          }
          await confEncrypt(cleanArgs[2]);
        } else {
          throw new Error(`Unknown conf subcommand: ${subcommand}`);
        }
        break;
      }

      case "send": {
        if (!cleanArgs[1]) {
          throw new Error("Usage: bnd send <file|->");
        }
        await send({ source: cleanArgs[1], rig: rigOverride, verbose });
        break;
      }

      case "receive": {
        if (!cleanArgs[1]) {
          throw new Error("Usage: bnd receive <file|->");
        }
        await receive({ source: cleanArgs[1], rig: rigOverride, verbose });
        break;
      }

      case "status": {
        await status({ rig: rigOverride, verbose });
        break;
      }

      case "upload": {
        await upload(cleanArgs.slice(1), verbose);
        break;
      }

      case "deploy": {
        await deploy(cleanArgs.slice(1), verbose);
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
        if (!cleanArgs[1]) {
          throw new Error("Usage: bnd observe <pattern>");
        }
        await observe({
          pattern: cleanArgs[1],
          rig: rigOverride,
          json,
          verbose,
        });
        break;
      }

      case "delete": {
        if (!cleanArgs[1]) {
          throw new Error("URI required. Usage: bnd delete <uri>");
        }
        await del(cleanArgs[1], verbose);
        break;
      }

      case "health": {
        await health(verbose);
        break;
      }

      case "config": {
        if (!subcommand || subcommand === "show") {
          await configShow();
        } else if (subcommand === "rig") {
          if (!cleanArgs[2]) {
            throw new Error(
              "Path required. Usage: bnd config rig <path|url>",
            );
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

      case "node": {
        if (!subcommand) {
          throw new Error(
            "Subcommand required. Usage: bnd node <keygen|config|status>",
          );
        }
        if (subcommand === "keygen") {
          await nodeKeygen(cleanArgs[2]);
        } else if (subcommand === "env") {
          if (!cleanArgs[2]) {
            throw new Error(
              "Key file path required. Usage: bnd node env <keyfile>",
            );
          }
          await nodeEnv(cleanArgs[2]);
        } else if (subcommand === "config") {
          const action = cleanArgs[2];
          if (action === "push") {
            if (!cleanArgs[3]) {
              throw new Error(
                "Config file path required. Usage: bnd node config push <file>",
              );
            }
            await nodeConfigPush(cleanArgs[3], verbose);
          } else if (action === "get") {
            if (!cleanArgs[3]) {
              throw new Error(
                "Node ID required. Usage: bnd node config get <nodeId>",
              );
            }
            await nodeConfigGet(cleanArgs[3], verbose);
          } else {
            throw new Error("Usage: bnd node config <push|get>");
          }
        } else if (subcommand === "status") {
          if (!cleanArgs[2]) {
            throw new Error(
              "Node ID required. Usage: bnd node status <nodeId>",
            );
          }
          await nodeStatus(cleanArgs[2], verbose);
        } else {
          throw new Error(`Unknown node subcommand: ${subcommand}`);
        }
        break;
      }

      case "network": {
        if (!subcommand) {
          throw new Error(
            "Subcommand required. Usage: bnd network <create|up|status>",
          );
        }
        if (subcommand === "create") {
          if (!cleanArgs[2]) {
            throw new Error(
              "Network name required. Usage: bnd network create <name>",
            );
          }
          await networkCreate(cleanArgs[2], cleanArgs[3]);
        } else if (subcommand === "up") {
          if (!cleanArgs[2]) {
            throw new Error(
              "Manifest path required. Usage: bnd network up <manifest>",
            );
          }
          await networkUp(cleanArgs[2], verbose);
        } else if (subcommand === "status") {
          if (!cleanArgs[2]) {
            throw new Error(
              "Network ID or manifest path required. Usage: bnd network status <id|path>",
            );
          }
          await networkStatus(cleanArgs[2], verbose);
        } else {
          throw new Error(`Unknown network subcommand: ${subcommand}`);
        }
        break;
      }

      case "server-keys": {
        if (subcommand === "env") {
          await serverKeysEnv();
        } else {
          throw new Error(
            "Unknown server-keys subcommand. Usage: bnd server-keys env",
          );
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
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Error: ${message}`);
    Deno.exit(1);
  }
}

// Run main function
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ Fatal error: ${message}`);
  Deno.exit(1);
});
