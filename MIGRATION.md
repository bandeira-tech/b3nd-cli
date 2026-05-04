# Migrating from v0.2 to v0.3

v0.3 is a complete redesign. The CLI is now a thin framework runner: it
loads a user-defined **rig module** and uses it to send / read /
observe / serve. Protocol concerns — signing, envelope-building,
content addressing, key management — live in your rig module (or in
the protocol package you import there), not in `bnd`.

If your v0.2 workflow relied on `bnd` knowing about canon-shaped URIs
or building signed envelopes, that work moves into your rig.

## What's removed

| v0.2 command | Replacement |
|---|---|
| `bnd account create [path]` | Generate keys with your protocol package; the CLI no longer manages identity |
| `bnd encrypt create [path]` | Same — encryption keys belong in your protocol layer |
| `bnd conf node <url>` | `bnd config rig <path>` (rig modules build clients) |
| `bnd conf account <path>` | n/a — rig holds identity if it needs one |
| `bnd conf encrypt <path>` | n/a |
| `bnd send <uri> <data>` | `bnd send <file>` — file contains a ready `[uri, payload]` Output |
| `bnd send -f <file>` | `bnd send <file>` (drop the `-f`) |
| `bnd list <uri>` | `bnd read <uri>/` (trailing slash → list) |
| `bnd watch <uri>` | `bnd observe <pattern>` |
| `bnd delete <uri>` | `bnd send` an Output with `null` payload (the framework's delete convention) |
| `bnd health` | `bnd status` |
| `bnd upload [-r] <path>` | Use your protocol's content-addressing helper, then `bnd send` the resulting Output |
| `bnd deploy ...` | App deployment was protocol-specific; move it to your protocol tooling |
| `bnd node keygen / env / config / status` | n/a — managed-node config is canon protocol territory; serve a rig with `bnd node <rig-source>` instead (coming soon) |
| `bnd network create / up / status` | Same — networks of managed nodes are protocol-level |
| `bnd server-keys env` | n/a |

## What you do instead

Step 1 — initialize a rig:

```sh
bnd config init
bnd config edit
```

That gives you a `~/.bnd/rig.ts` (or `./b3nd.rig.ts` if you put it in
your project) that exports a `Rig`. Wire it however you want — point
at a remote node over HTTP, use a memory store locally, fan out to
multiple targets with patterns, etc.

Step 2 — run commands; they all use the rig:

```sh
bnd status                              # rig.status()
bnd send envelope.json                  # rig.send([output])
cat envelope.json | bnd send -          # stdin (single JSON)
bnd observe pat --json | bnd send -     # NDJSON stream from stdin
bnd read mutable://foo                  # rig.read([uri])
bnd read mutable://foo/                 # trailing slash → list
bnd observe 'mutable://*'               # rig.observe(pattern, signal)
```

If your protocol produces signed/encrypted envelopes (e.g. via canon's
`message()`), do that wherever you used to do it before — in a script,
in a notebook, in your protocol's own CLI — and pipe the resulting
`[uri, payload]` JSON into `bnd send`.

## Rig resolution

Every command resolves the rig in this order:

1. `--rig <path|url>` flag (anywhere in argv)
2. `./b3nd.rig.ts` (or `.js`) in current directory
3. `rig = "..."` in `~/.bnd/config.toml`
4. Helpful error if none of the above

`<path|url>` accepts local paths (relative or absolute) and any URL
scheme Deno's dynamic `import()` supports — `jsr:`, `npm:`, `https:`,
`file:`.

## Config file change

The v0.2 keys (`node`, `account`, `encrypt`) are gone. v0.3 only
recognizes `rig`. Old keys in your existing `~/.bnd/config.toml` are
silently ignored — feel free to delete them.

## Universal flags

These work on every command:

- `-v` / `--verbose` — progress to stderr
- `--rig <path|url>` — override the resolved rig for this run
- `--json` — machine-friendly output (NDJSON for `observe`, JSON array
  for `read`)
