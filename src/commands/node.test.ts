import { assertEquals } from "@std/assert";
import {
  DEFAULT_HOST,
  isLoopback,
  parseAddr,
  parseNodeFlags,
  resolveHostname,
} from "./node.ts";

// ── secure-by-default host policy ────────────────────────────────────────

Deno.test("DEFAULT_HOST is loopback", () => {
  assertEquals(DEFAULT_HOST, "127.0.0.1");
  assertEquals(isLoopback(DEFAULT_HOST), true);
});

Deno.test("resolveHostname: unspecified host → secure default (localhost)", () => {
  assertEquals(resolveHostname({ port: 3000 }), "127.0.0.1");
});

Deno.test("resolveHostname: explicit host passes through (opt-in to exposure)", () => {
  assertEquals(resolveHostname({ hostname: "0.0.0.0", port: 3000 }), "0.0.0.0");
  assertEquals(
    resolveHostname({ hostname: "192.168.1.5", port: 3000 }),
    "192.168.1.5",
  );
});

Deno.test("isLoopback: recognises loopback forms, rejects exposed hosts", () => {
  for (const h of ["127.0.0.1", "::1", "[::1]", "localhost"]) {
    assertEquals(isLoopback(h), true, h);
  }
  for (const h of ["0.0.0.0", "192.168.1.5", "10.0.0.2", ""]) {
    assertEquals(isLoopback(h), false, h);
  }
});

// ── parseAddr ────────────────────────────────────────────────────────────

Deno.test("parseAddr: empty → default port, no hostname", () => {
  assertEquals(parseAddr("", 3000), { port: 3000 });
});

Deno.test("parseAddr: bare port", () => {
  assertEquals(parseAddr("4000", 3000), { port: 4000 });
});

Deno.test("parseAddr: colon-prefixed port", () => {
  assertEquals(parseAddr(":4000", 3000), { port: 4000 });
});

Deno.test("parseAddr: host:port", () => {
  assertEquals(parseAddr("0.0.0.0:4000", 3000), {
    hostname: "0.0.0.0",
    port: 4000,
  });
  assertEquals(parseAddr("localhost:8080", 3000), {
    hostname: "localhost",
    port: 8080,
  });
});

Deno.test("parseAddr: garbage → falls back to default port", () => {
  assertEquals(parseAddr("nope", 3000), { port: 3000 });
  assertEquals(parseAddr(":nope", 3000), { port: 3000 });
});

// ── parseNodeFlags ───────────────────────────────────────────────────────

Deno.test("parseNodeFlags: empty → no flags, no positional", () => {
  assertEquals(parseNodeFlags([]), { positional: [], flags: {} });
});

Deno.test("parseNodeFlags: bare --http uses default port", () => {
  assertEquals(parseNodeFlags(["--http"]), {
    positional: [],
    flags: { http: { port: 3000 } },
  });
});

Deno.test("parseNodeFlags: --http=port", () => {
  assertEquals(parseNodeFlags(["--http=4000"]), {
    positional: [],
    flags: { http: { port: 4000 } },
  });
});

Deno.test("parseNodeFlags: --http=host:port", () => {
  assertEquals(parseNodeFlags(["--http=0.0.0.0:4000"]), {
    positional: [],
    flags: { http: { hostname: "0.0.0.0", port: 4000 } },
  });
});

Deno.test("parseNodeFlags: --grpc default port differs from --http", () => {
  assertEquals(parseNodeFlags(["--grpc"]).flags.grpc, { port: 50051 });
});

Deno.test("parseNodeFlags: --mcp / --watch are booleans", () => {
  assertEquals(parseNodeFlags(["--mcp", "--watch"]), {
    positional: [],
    flags: { mcp: true, watch: true },
  });
});

Deno.test("parseNodeFlags: --cors takes the next arg", () => {
  assertEquals(parseNodeFlags(["--cors", "*"]), {
    positional: [],
    flags: { cors: "*" },
  });
});

Deno.test("parseNodeFlags: all transports + cors + watch", () => {
  assertEquals(
    parseNodeFlags([
      "--http=4000",
      "--grpc=:50000",
      "--mcp",
      "--cors",
      "https://app.example.com",
      "--watch",
    ]),
    {
      positional: [],
      flags: {
        http: { port: 4000 },
        grpc: { port: 50000 },
        mcp: true,
        cors: "https://app.example.com",
        watch: true,
      },
    },
  );
});

Deno.test("parseNodeFlags: positional rig path passes through", () => {
  assertEquals(parseNodeFlags(["./my-rig.ts", "--http"]), {
    positional: ["./my-rig.ts"],
    flags: { http: { port: 3000 } },
  });
});

Deno.test("parseNodeFlags: unknown flags pass through as positional (don't swallow)", () => {
  // We're conservative — only known node flags are extracted; the
  // rest is left for upstream/main to make sense of (or error on).
  assertEquals(parseNodeFlags(["--unknown", "value"]), {
    positional: ["--unknown", "value"],
    flags: {},
  });
});
