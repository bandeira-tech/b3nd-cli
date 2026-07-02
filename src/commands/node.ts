/**
 * `bnd node` — host the resolved rig over one or more transports.
 *
 *   bnd node                              # default: --http on :3000
 *   bnd node ./my-rig.ts                  # explicit rig (positional)
 *   bnd node --http                       # HTTP on default port (:3000)
 *   bnd node --http=4000                  # HTTP on :4000
 *   bnd node --http=0.0.0.0:4000          # HTTP bound to host:port
 *   bnd node --grpc                       # gRPC-HTTP on default port (:50051)
 *   bnd node --ws                         # WebSocket on default port (:8080)
 *   bnd node --mcp                        # MCP over stdio
 *   bnd node --mcp-http                   # MCP over Streamable HTTP (:3001)
 *   bnd node --mcp-ws                     # MCP over WebSocket (:8081)
 *   bnd node --http --grpc --mcp          # mix and match
 *   bnd node --cors '*'                   # CORS wrapper for HTTP-speaking transports
 *   bnd node --watch                      # restart on rig file change
 *
 * The `--rig <path|url>` flag and the optional positional rig path
 * follow the universal resolution rule: explicit > project file > config.
 *
 * MCP stdio captures stdio for JSON-RPC; all CLI status messages go to
 * stderr (this is true for every command via the Logger).
 *
 * Transports are wired directly against `@bandeira-tech/b3nd-move`:
 * httpApi / wsApi / grpcHttpApi / mcpHttpApi / mcpWsApi for fetch-style
 * mounts, and the upstream MCP SDK's StdioServerTransport for stdio.
 * CORS is a thin wrapper around HTTP-speaking handlers (no equivalent
 * exists in b3nd-move — it's deliberately host-runtime concern).
 */

import { loadConfig } from "../config.ts";
import { loadRig, resolveRigSource, type RigLike } from "../rig-loader.ts";
import { createLogger } from "../logger.ts";
import { httpApi } from "@bandeira-tech/b3nd-move/http/service";
import { wsApi } from "@bandeira-tech/b3nd-move/ws/service";
import { grpcHttpApi } from "@bandeira-tech/b3nd-move/grpc/http/service";
import { httpOutputsFrame } from "@bandeira-tech/b3nd-move/codecs/http";
import { wsJsonEnvelope } from "@bandeira-tech/b3nd-move/codecs/ws";
import { grpcProto } from "@bandeira-tech/b3nd-move/codecs/grpc";
import { mcpTextJsonStringify } from "@bandeira-tech/b3nd-move/codecs/mcp";
import {
  buildMcpServer,
  type McpServerOptions,
} from "@bandeira-tech/b3nd-move/mcp/service";
import { mcpHttpApi } from "@bandeira-tech/b3nd-move/mcp/http/service";
import { mcpWsApi } from "@bandeira-tech/b3nd-move/mcp/ws/service";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "../version.ts";

interface AddrFlag {
  port: number;
  hostname?: string;
}

interface NodeFlags {
  http?: AddrFlag;
  ws?: AddrFlag;
  grpc?: AddrFlag;
  mcp?: boolean;
  mcpHttp?: AddrFlag;
  mcpWs?: AddrFlag;
  cors?: string;
  watch?: boolean;
}

interface TransportServer {
  readonly transport: string;
  readonly address: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Parse `bnd node`-specific flags. Recognised:
 *   --http[=port|host:port]      default port 3000
 *   --ws[=port|host:port]        default port 8080
 *   --grpc[=port|host:port]      default port 50051
 *   --mcp                        stdio MCP server
 *   --mcp-http[=port|host:port]  default port 3001
 *   --mcp-ws[=port|host:port]    default port 8081
 *   --cors <value>               CORS origin for HTTP-speaking transports
 *   --watch                      restart on rig file change
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
    } else if (a === "--ws") flags.ws = { port: 8080 };
    else if (a.startsWith("--ws=")) {
      flags.ws = parseAddr(a.slice("--ws=".length), 8080);
    } else if (a === "--grpc") flags.grpc = { port: 50051 };
    else if (a.startsWith("--grpc=")) {
      flags.grpc = parseAddr(a.slice("--grpc=".length), 50051);
    } else if (a === "--mcp") flags.mcp = true;
    else if (a === "--mcp-http") flags.mcpHttp = { port: 3001 };
    else if (a.startsWith("--mcp-http=")) {
      flags.mcpHttp = parseAddr(a.slice("--mcp-http=".length), 3001);
    } else if (a === "--mcp-ws") flags.mcpWs = { port: 8081 };
    else if (a.startsWith("--mcp-ws=")) {
      flags.mcpWs = parseAddr(a.slice("--mcp-ws=".length), 8081);
    } else if (a === "--watch") flags.watch = true;
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
export function parseAddr(s: string, defaultPort: number): AddrFlag {
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

/**
 * Build the onClose callback for the MCP stdio transport.
 *
 * When stdio is the only transport, a client disconnect (stdin EOF) should
 * abort the node controller — MCP hosts (Claude Code, etc.) terminate stdio
 * servers by closing stdin, not by sending SIGINT. When combined with
 * network transports, keep serving and just log.
 *
 * Exported for unit testing.
 */
export function makeMcpCloseCallback(
  ctrl: AbortController,
  stdioIsOnly: boolean,
  say: (m: string) => void,
): () => void {
  if (stdioIsOnly) return () => ctrl.abort();
  return () => say("MCP stdio client disconnected; network transports remain up");
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
  if (
    !flags.http &&
    !flags.ws &&
    !flags.grpc &&
    !flags.mcp &&
    !flags.mcpHttp &&
    !flags.mcpWs
  ) {
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

  // Wire SIGINT (and, for stdio-only MCP, stdin EOF) to this controller.
  // The controller is created before startOnce() so the mcpStdioTransport
  // builder can close over it.
  const ctrl = new AbortController();
  const onSig = () => ctrl.abort();
  Deno.addSignalListener("SIGINT", onSig);

  // Stdio is the only transport when --mcp is set without any network transport.
  // In that case closing stdin (MCP client disconnect) should shut the node down.
  const stdioIsOnly = !!flags.mcp &&
    !flags.http && !flags.ws && !flags.grpc && !flags.mcpHttp && !flags.mcpWs;

  const buildServers = (rig: RigLike): TransportServer[] => {
    const servers: TransportServer[] = [];
    if (flags.http) servers.push(httpTransport(rig, flags.http, flags.cors));
    if (flags.ws) servers.push(wsTransport(rig, flags.ws));
    if (flags.grpc) servers.push(grpcTransport(rig, flags.grpc, flags.cors));
    if (flags.mcp) {
      const onMcpClose = makeMcpCloseCallback(ctrl, stdioIsOnly, say);
      servers.push(mcpStdioTransport(rig, onMcpClose));
    }
    if (flags.mcpHttp) {
      servers.push(mcpHttpTransport(rig, flags.mcpHttp, flags.cors));
    }
    if (flags.mcpWs) servers.push(mcpWsTransport(rig, flags.mcpWs));
    return servers;
  };

  const startOnce = async (): Promise<TransportServer[]> => {
    logger.info(`Loading rig: ${source.input} (${source.origin})`);
    const { rig } = await loadRig({
      explicit: explicitRig,
      configRig: config.rig,
    });
    const servers = buildServers(rig);
    await Promise.all(servers.map((s) => s.start()));
    for (const s of servers) say(`✓ ${s.transport.padEnd(10)} ${s.address}`);
    return servers;
  };

  let servers = await startOnce();

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

// ── Transport builders ──────────────────────────────────────────────────
//
// Each builder returns a `TransportServer` with start/stop lifecycle.
// The rig-loader uses a duck-typed `RigLike` to avoid coupling to a
// specific b3nd-core version; the b3nd-move services type their argument
// as `Rig`, so we cast at the boundary.

function httpTransport(
  rig: RigLike,
  addr: AddrFlag,
  cors: string | undefined,
): TransportServer {
  const port = addr.port;
  const hostname = addr.hostname ?? "0.0.0.0";
  const handler = withCors(
    // deno-lint-ignore no-explicit-any
    httpApi(rig as any, { codec: httpOutputsFrame() }),
    cors,
  );
  let server: Deno.HttpServer | null = null;
  return {
    transport: "http",
    address: `http://${hostname}:${port}`,
    start() {
      server = Deno.serve({ port, hostname }, handler);
      return Promise.resolve();
    },
    async stop() {
      await server?.shutdown();
      server = null;
    },
  };
}

function wsTransport(rig: RigLike, addr: AddrFlag): TransportServer {
  const port = addr.port;
  const hostname = addr.hostname ?? "0.0.0.0";
  // deno-lint-ignore no-explicit-any
  const attach = wsApi(rig as any, { codec: wsJsonEnvelope() });
  const sockets = new Set<WebSocket>();
  const handler = (req: Request): Response => {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Not Found", { status: 404 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    sockets.add(socket);
    socket.addEventListener("close", () => sockets.delete(socket), {
      once: true,
    });
    attach(socket);
    return response;
  };
  let server: Deno.HttpServer | null = null;
  return {
    transport: "ws",
    address: `ws://${hostname}:${port}`,
    start() {
      server = Deno.serve({ port, hostname }, handler);
      return Promise.resolve();
    },
    async stop() {
      await drainSockets(sockets);
      await server?.shutdown();
      server = null;
    },
  };
}

function grpcTransport(
  rig: RigLike,
  addr: AddrFlag,
  cors: string | undefined,
): TransportServer {
  const port = addr.port;
  const hostname = addr.hostname ?? "0.0.0.0";
  const handler = withCors(
    // deno-lint-ignore no-explicit-any
    grpcHttpApi(rig as any, { codec: grpcProto() }),
    cors,
  );
  let server: Deno.HttpServer | null = null;
  return {
    transport: "grpc",
    address: `http://${hostname}:${port}`,
    start() {
      server = Deno.serve({ port, hostname }, handler);
      return Promise.resolve();
    },
    async stop() {
      await server?.shutdown();
      server = null;
    },
  };
}

function mcpStdioTransport(
  rig: RigLike,
  onClose?: () => void,
): TransportServer {
  let transport: StdioServerTransport | null = null;
  return {
    transport: "mcp",
    address: "stdio",
    async start() {
      // deno-lint-ignore no-explicit-any
      const server = buildMcpServer(rig as any, mcpOpts());
      transport = new StdioServerTransport();
      await server.connect(transport);
      // server.connect() wires transport.onclose → server.close().
      // Chain our shutdown hook so stdin EOF propagates to the node controller.
      if (onClose) {
        const prev = transport.onclose;
        transport.onclose = async () => {
          await prev?.();
          onClose();
        };
      }
    },
    async stop() {
      await transport?.close();
      transport = null;
    },
  };
}

function mcpHttpTransport(
  rig: RigLike,
  addr: AddrFlag,
  cors: string | undefined,
): TransportServer {
  const port = addr.port;
  const hostname = addr.hostname ?? "0.0.0.0";
  // deno-lint-ignore no-explicit-any
  const handler = withCors(mcpHttpApi(rig as any, mcpOpts()), cors);
  let server: Deno.HttpServer | null = null;
  return {
    transport: "mcp-http",
    address: `http://${hostname}:${port}`,
    start() {
      server = Deno.serve({ port, hostname }, handler);
      return Promise.resolve();
    },
    async stop() {
      await server?.shutdown();
      server = null;
    },
  };
}

function mcpWsTransport(rig: RigLike, addr: AddrFlag): TransportServer {
  const port = addr.port;
  const hostname = addr.hostname ?? "0.0.0.0";
  // deno-lint-ignore no-explicit-any
  const attach = mcpWsApi(rig as any, mcpOpts());
  const sockets = new Set<WebSocket>();
  const handler = (req: Request): Response => {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Not Found", { status: 404 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req, {
      protocol: "mcp",
    });
    sockets.add(socket);
    socket.addEventListener("close", () => sockets.delete(socket), {
      once: true,
    });
    attach(socket);
    return response;
  };
  let server: Deno.HttpServer | null = null;
  return {
    transport: "mcp-ws",
    address: `ws://${hostname}:${port}`,
    start() {
      server = Deno.serve({ port, hostname }, handler);
      return Promise.resolve();
    },
    async stop() {
      await drainSockets(sockets);
      await server?.shutdown();
      server = null;
    },
  };
}

function mcpOpts(): McpServerOptions {
  return { name: "bnd", version: VERSION, codec: mcpTextJsonStringify() };
}

// ── Helpers ─────────────────────────────────────────────────────────────

type Handler = (req: Request) => Promise<Response>;

/**
 * Wrap a fetch handler in a CORS layer. No-op when `origin` is falsy.
 * Echoes the requested method/headers on preflight so the browser
 * never has to guess. b3nd-move deliberately omits CORS — host
 * runtimes (this one included) own the policy.
 */
function withCors(handler: Handler, origin: string | undefined): Handler {
  if (!origin) return handler;
  return async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(req, origin),
      });
    }
    const res = await handler(req);
    const headers = new Headers(res.headers);
    corsHeaders(req, origin).forEach((v, k) => headers.set(k, v));
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}

function corsHeaders(req: Request, origin: string): Headers {
  const reqMethods = req.headers.get("access-control-request-method");
  const reqHeaders = req.headers.get("access-control-request-headers");
  const h = new Headers();
  h.set("access-control-allow-origin", origin);
  h.set("access-control-allow-methods", reqMethods ?? "GET, POST, OPTIONS");
  h.set("access-control-allow-headers", reqHeaders ?? "content-type");
  h.set("access-control-max-age", "86400");
  if (origin !== "*") h.set("vary", "origin");
  return h;
}

function drainSockets(sockets: Set<WebSocket>): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const socket of sockets) {
    if (
      socket.readyState === WebSocket.CLOSED ||
      socket.readyState === WebSocket.CLOSING
    ) continue;
    waits.push(
      new Promise<void>((resolve) => {
        const done = () => resolve();
        socket.addEventListener("close", done, { once: true });
        socket.addEventListener("error", done, { once: true });
        try {
          socket.close(1001, "server shutting down");
        } catch {
          resolve();
        }
      }),
    );
  }
  return Promise.all(waits).then(() => {});
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
