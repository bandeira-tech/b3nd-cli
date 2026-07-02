/**
 * Smoke tests — no rig required (except bnd-node-mcp-exit which uses TEST_RIG).
 * Verifies CLI entry points, help output, and argument-validation errors.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { DENO_DIR, MAIN, runBnd, TEST_RIG } from "./helpers.ts";

// Use a non-existent HOME so no real config is ever read.
const NO_RIG = { HOME: "/tmp/bnd-smoke-test-no-home" };

Deno.test("bnd (no args) → exit 0, prints usage", async () => {
  const { stdout, code } = await runBnd([], { env: NO_RIG });
  assertEquals(code, 0);
  assertStringIncludes(stdout, "bnd — B3nd CLI");
  assertStringIncludes(stdout, "Commands:");
});

Deno.test("bnd --help → exit 0, prints usage", async () => {
  const { stdout, code } = await runBnd(["--help"], { env: NO_RIG });
  assertEquals(code, 0);
  assertStringIncludes(stdout, "bnd — B3nd CLI");
});

Deno.test("bnd help → exit 0, prints usage", async () => {
  const { stdout, code } = await runBnd(["help"], { env: NO_RIG });
  assertEquals(code, 0);
  assertStringIncludes(stdout, "Commands:");
});

Deno.test("bnd <unknown-command> → exit 1, error on stderr", async () => {
  const { stderr, code } = await runBnd(["frobnicate"], { env: NO_RIG });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "Unknown command");
  assertStringIncludes(stderr, "frobnicate");
});

Deno.test("bnd send (missing arg) → exit 1, usage hint", async () => {
  const { stderr, code } = await runBnd(["send"], { env: NO_RIG });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "bnd send");
});

Deno.test("bnd receive (missing arg) → exit 1, usage hint", async () => {
  const { stderr, code } = await runBnd(["receive"], { env: NO_RIG });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "bnd receive");
});

Deno.test("bnd read (missing uri) → exit 1, usage hint", async () => {
  const { stderr, code } = await runBnd(["read"], { env: NO_RIG });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "bnd read");
});

Deno.test("bnd observe (missing pattern) → exit 1, usage hint", async () => {
  const { stderr, code } = await runBnd(["observe"], { env: NO_RIG });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "bnd observe");
});

Deno.test("bnd config <unknown-sub> → exit 1, error on stderr", async () => {
  const { stderr, code } = await runBnd(["config", "frobnicate"], {
    env: NO_RIG,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "Unknown config subcommand");
});

Deno.test("bnd status with no rig → exit 1, 'No rig' on stderr", async () => {
  const { stderr, code } = await runBnd(["status"], { env: NO_RIG });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "No rig");
});

// ── bnd node --mcp stdio exit ─────────────────────────────────────────────

Deno.test(
  "bnd node --mcp exits cleanly when stdin closes (MCP client disconnect)",
  async () => {
    // MCP hosts (Claude Code, etc.) terminate stdio servers by closing stdin,
    // not by signalling the process group. Verify that the process exits with
    // code 0 when its stdin is closed while stdio is the only transport.
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-net",
        MAIN,
        "node",
        "--mcp",
        "--rig",
        TEST_RIG,
      ],
      env: { ...Deno.env.toObject(), DENO_DIR },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    // Wait for the ready signal ("✓ mcp        stdio") so we know the MCP
    // server has connected to the stdio transport before we close stdin.
    const rd = child.stderr.getReader();
    const dec = new TextDecoder();
    let stderrBuf = "";
    while (!stderrBuf.includes("✓ mcp")) {
      const { done, value } = await rd.read();
      if (done) break;
      stderrBuf += dec.decode(value);
    }
    rd.releaseLock();

    // Close stdin — this is how the MCP host signals it is done.
    await child.stdin.close();

    // The process should exit cleanly within a reasonable timeout.
    const result = await Promise.race([
      child.status,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("process did not exit within 5 s")),
          5000,
        )
      ),
    ]);

    assertEquals(result.code, 0);
  },
  { sanitizeOps: false, sanitizeResources: false },
);
