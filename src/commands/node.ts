/**
 * `bnd node` — host the resolved rig over one or more transports.
 *
 *   bnd node                              # default: --http on :3000
 *   bnd node ./my-rig.ts                  # explicit rig (positional)
 *   bnd node --http                       # HTTP on default port (:3000)
 *   bnd node --http=4000                  # HTTP on :4000
 *   bnd node --http=0.0.0.0:4000          # HTTP bound to host:port
 *   bnd node --grpc                       # gRPC on default port (:50051)
 *   bnd node --mcp                        # MCP over stdio
 *   bnd node --http --grpc --mcp          # all three
 *   bnd node --cors '*'                   # CORS for HTTP/gRPC
 *   bnd node --watch                      # restart on rig file change
 *
 * The `--rig <path|url>` flag and the optional positional rig path
 * follow the universal resolution rule: explicit > project file > config.
 *
 * MCP captures stdio for JSON-RPC; all CLI status messages go to
 * stderr (this is true for every command via the Logger).
 */

import { loadConfig } from "../config.ts";
import { loadRig, resolveRigSource } from "../rig-loader.ts";
import { createLogger } from "../logger.ts";
import {
  createServers,
  type ServerComposition,
  type ServerResolver,
  type TransportServer,
} from "@bandeira-tech/b3nd-servers";
import { httpServer } from "@bandeira-tech/b3nd-servers/http";
import { grpcHttpServer } from "@bandeira-tech/b3nd-servers/grpc/http/server";
import { mcpServer } from "@bandeira-tech/b3nd-servers/mcp/server";

interface NodeFlags {
  http?: { port: number; hostname?: string };
  grpc?: { port: number; hostname?: string };
  mcp?: boolean;
  cors?: string;
  watch?: boolean;
}

/**
 * Parse `bnd node`-specific flags. Recognised:
 *   --http[=port|host:port]    default port 3000
 *   --grpc[=port|host:port]    default port 50051
 *   --mcp                      stdio MCP server
 *   --cors <value>             CORS origin for HTTP/gRPC (e.g. "*")
 *   --watch                    restart on rig file change
 *
 * Anything else stays in `positional`.
 */
export function parseNodeFlags(
  args: string[],
): { positional: string[]; flags: NodeFlags } {
  const flags: NodeFlags = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--http") flags.http = { port: 3000 };
    else if (a.startsWith("--http=")) {
      flags.http = parseAddr(a.slice("--http=".length), 3000);
    } else if (a === "--grpc") flags.grpc = { port: 50051 };
    else if (a.startsWith("--grpc=")) {
      flags.grpc = parseAddr(a.slice("--grpc=".length), 50051);
    } else if (a === "--mcp") flags.mcp = true;
    else if (a === "--watch") flags.watch = true;
    else if (a === "--cors" && args[i + 1] !== undefined) {
      flags.cors = args[++i];
    } else positional.push(a);
  }
  return { positional, flags };
}

/**
 * Parse a host:port / port / :port string. Returns the default port if
 * input is empty or unparseable.
 */
export function parseAddr(
  s: string,
  defaultPort: number,
): { port: number; hostname?: string } {
  if (!s) return { port: defaultPort };
  const trimmed = s.startsWith(":") ? s.slice(1) : s;
  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    const port = Number(trimmed);
    return Number.isFinite(port) && port > 0 ? { port } : { port: defaultPort };
  }
  const port = Number(trimmed.slice(colon + 1));
  return {
    hostname: trimmed.slice(0, colon),
    port: Number.isFinite(port) && port > 0 ? port : defaultPort,
  };
}

export async function node(opts: {
  rig?: string;
  verbose?: boolean;
  args: string[];
}): Promise<void> {
  const logger = createLogger(opts.verbose ?? false);
  const { positional, flags } = parseNodeFlags(opts.args);
  const explicitRig = opts.rig ?? positional[0];

  // No transport specified → default to --http
  if (!flags.http && !flags.grpc && !flags.mcp) {
    flags.http = { port: 3000 };
  }

  const config = await loadConfig();
  const source = await resolveRigSource({
    explicit: explicitRig,
    cwd: Deno.cwd(),
    configRig: config.rig,
  });

  // CLI status to stderr always (stdout might be MCP JSON-RPC).
  const say = (m: string) => console.error(m);

  const composition: ServerComposition | undefined = flags.cors
    ? { cors: flags.cors }
    : undefined;

  const buildResolvers = (): ServerResolver[] => {
    const r: ServerResolver[] = [];
    if (flags.http) {
      r.push(httpServer({
        port: flags.http.port,
        hostname: flags.http.hostname,
      }));
    }
    if (flags.grpc) {
      r.push(grpcHttpServer({
        port: flags.grpc.port,
        hostname: flags.grpc.hostname,
      }));
    }
    if (flags.mcp) r.push(mcpServer());
    return r;
  };

  const startOnce = async (): Promise<TransportServer[]> => {
    logger.info(`Loading rig: ${source.input} (${source.origin})`);
    const { rig } = await loadRig({
      explicit: explicitRig,
      configRig: config.rig,
    });
    // The user's rig module has the real Rig type at its source; cast
    // here because rig-loader uses a duck-typed RigLike to avoid
    // coupling to a specific b3nd-core version.
    const servers = createServers(
      // deno-lint-ignore no-explicit-any
      rig as any,
      buildResolvers(),
      composition,
    );
    await Promise.all(servers.map((s) => s.start()));
    for (const s of servers) say(`✓ ${s.transport.padEnd(10)} ${s.address}`);
    return servers;
  };

  let servers = await startOnce();

  // Wire SIGINT once — closes the watcher (if any) and stops servers.
  const ctrl = new AbortController();
  const onSig = () => ctrl.abort();
  Deno.addSignalListener("SIGINT", onSig);

  try {
    if (flags.watch) {
      say(`Watching ${source.url} for changes (--watch)`);
      const watchPath = source.url.startsWith("file:")
        ? new URL(source.url).pathname
        : null;
      if (!watchPath) {
        say(
          `! --watch ignored: rig is not a local file (${source.input})`,
        );
        await waitForAbort(ctrl.signal);
      } else {
        await runWatchLoop(
          watchPath,
          ctrl.signal,
          () => servers,
          async () => {
            try {
              await Promise.all(servers.map((s) => s.stop()));
              say(`Restarting…`);
              servers = await startOnce();
            } catch (e) {
              say(
                `✗ Restart failed: ${
                  e instanceof Error ? e.message : String(e)
                }`,
              );
            }
          },
        );
      }
    } else {
      await waitForAbort(ctrl.signal);
    }
  } finally {
    Deno.removeSignalListener("SIGINT", onSig);
    say(`Shutting down…`);
    await Promise.all(servers.map((s) => s.stop().catch(() => {})));
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Watch a path and trigger `onChange` after a 200ms quiet window
 * (debounce so a single save doesn't fire multiple times).
 */
async function runWatchLoop(
  path: string,
  signal: AbortSignal,
  _getServers: () => TransportServer[],
  onChange: () => Promise<void>,
): Promise<void> {
  const watcher = Deno.watchFs(path);
  const onAbort = () => {
    try {
      watcher.close();
    } catch { /* already closed */ }
  };
  signal.addEventListener("abort", onAbort, { once: true });

  let timer: number | null = null;
  try {
    for await (const event of watcher) {
      if (event.kind !== "modify" && event.kind !== "create") continue;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, 200);
    }
  } catch (e) {
    // Watcher closed during shutdown — swallow.
    if (!signal.aborted) throw e;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
