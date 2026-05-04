# b3nd CLI (`bnd`)

A thin framework runner for [B3nd](https://github.com/bandeira-tech/b3nd).
Loads a user-defined **rig module** and uses it to send / receive / read /
observe data, or to host the rig over HTTP / gRPC / MCP.

The CLI doesn't know about signing, envelopes, content addressing or any
other protocol concern — those live in your rig module (or in the protocol
package you import there). `bnd` is the runner; your rig is the wiring.

## Install

Requires Deno 2.x.

```bash
# From JSR (recommended)
deno install --global -A -n bnd jsr:@bandeira-tech/b3nd-cli

# Or compile a standalone binary
deno install --global -A -n bnd jsr:@bandeira-tech/b3nd-cli
# …then `bnd help`
```

For local development inside this repo, use `deno task dev <args>`.

## Quickstart

```bash
bnd config init        # scaffold ~/.bnd/rig.ts and point config at it
bnd config edit        # open the rig file in $EDITOR
bnd status             # check the rig is reachable
```

You're done — every other command flows through the rig.

## Commands

```
bnd send <file|->                 Send ready outputs (rig.send)
bnd receive <file|->              Ingest ready outputs (rig.receive)
bnd read <uri> [<uri>...]         Read URIs (trailing slash → list children)
bnd observe <pattern>             Subscribe to URI pattern (Ctrl+C to stop)
bnd status                        Show resolved rig health
bnd node [<rig>]                  Host the rig over HTTP/gRPC/MCP
                                  Flags: --http[=port] --grpc[=port] --mcp
                                         --cors '*' --watch

bnd config                        Show current config + resolved rig
bnd config init [<path>]          Scaffold a starter b3nd.rig.ts
bnd config rig <path|url>         Set the default rig
bnd config edit                   Open the resolved rig in $EDITOR
```

## The rig module

A **rig module** is a TypeScript (or JavaScript) file that default-exports a
`Rig` instance — or a function that returns one. Every command imports it
and uses it.

```ts
// b3nd.rig.ts
import {
  Rig,
  connection,
  createClientFromUrl,
} from "jsr:@bandeira-tech/b3nd-core@^0.12.0/rig";

export default async () => {
  const client = await createClientFromUrl("https://node.example.com");
  const all = connection(client, ["*"]);
  return new Rig({
    routes: { send: [all], receive: [all], read: [all], observe: [all] },
  });
};
```

The default export can be:

- a `Rig` instance directly, or
- a function `() => Rig | Promise<Rig>`, or
- an async function that receives `Deno.env.toObject()` if you want env-driven config:
  `async (env) => buildRig(env)`.

Resolution order (every command does this):

1. `--rig <path|url>` flag — wins if present.
2. `./b3nd.rig.ts` (or `.js`) in the current directory — picked up automatically.
3. `rig = "..."` in `~/.bnd/config.toml` — your global default.

The `<path|url>` accepts anything Deno's dynamic `import()` does:
relative paths, absolute paths, `jsr:`, `npm:`, `https:`, `file:`.

## Universal flags

These work on any command:

| Flag | Effect |
|---|---|
| `-v` / `--verbose` | Progress chatter to stderr |
| `--rig <path\|url>` | Override the resolved rig for this run |
| `--json` | Machine output (NDJSON for `observe`, JSON array for `read`) |

## Streaming (pipes)

`bnd send` and `bnd receive` read from a file or stdin. For stdin, the
input format is auto-detected:

- **NDJSON streaming** — first non-empty line parses as JSON on its own;
  each subsequent line is dispatched as it arrives.
- **Buffered single-JSON** — first line doesn't parse standalone (e.g.
  pretty-printed multi-line JSON); read everything, parse at EOF.

So both work seamlessly:

```bash
# A single ready output
echo '["mutable://x", {"v": 1}]' | bnd send -

# An NDJSON stream
my-protocol-tool | bnd send -

# Pipe between two nodes (with a one-line jq reshape because observe
# emits ReadResult objects, not Output tuples)
bnd observe 'mutable://*' --json \
  | jq -c '[.uri, .record.data]' \
  | bnd receive -
```

Each line of `bnd send`/`bnd receive` output is `✓ <uri>` on accept or
`✗ <uri> — <error>` on reject; non-zero exit on any reject.

## Hosting a rig

`bnd node` exposes the rig over one or more transports using
[`@bandeira-tech/b3nd-servers`](https://jsr.io/@bandeira-tech/b3nd-servers).

```bash
bnd node                       # default: --http on :3000
bnd node ./my-rig.ts           # explicit rig
bnd node --http=4000           # custom port
bnd node --http=0.0.0.0:4000   # bind hostname:port
bnd node --grpc                # gRPC on :50051
bnd node --mcp                 # MCP over stdio
bnd node --http --grpc --mcp   # all three
bnd node --cors '*'            # CORS for HTTP/gRPC
bnd node --watch               # restart on rig file change
```

When `--mcp` is set, stdout is reserved for MCP JSON-RPC; bnd's status
output goes to stderr (this is true for every command — `stdout = data`,
`stderr = chatter`).

## Configuration

`~/.bnd/config.toml` is a single-line file:

```toml
rig = "/Users/me/.bnd/rig.ts"
```

That's the entire schema. Everything else is in your rig module.

## Project layout

```
src/
  main.ts              # argv routing
  config.ts            # ~/.bnd/config.toml read/write
  rig-loader.ts        # rig resolution + dynamic import + duck-typing
  io.ts                # file/stdin → ready outputs (NDJSON auto-detect)
  logger.ts            # verbose chatter (always to stderr)
  commands/
    config.ts          # bnd config init / rig / edit / show
    send.ts            # bnd send / bnd receive
    read.ts            # bnd read
    observe.ts         # bnd observe
    status.ts          # bnd status
    node.ts            # bnd node (HTTP/gRPC/MCP + --watch)
  templates/
    starter.rig.ts     # written by `bnd config init`
```

## Development

```bash
deno task dev <args>    # run the CLI from source
deno task fmt           # format
deno task lint          # lint
deno task check         # type-check
deno task test          # run unit tests
deno task compile       # produce a standalone `bnd` binary
```

CI runs `fmt:check + lint + check + test` on every push and PR.

## License

MIT
