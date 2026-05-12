import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  rigEnv,
  runBnd,
  TEST_RIG,
  withTempFile,
  withTempHome,
} from "./helpers.ts";

const TWO_OUTPUTS = JSON.stringify([
  ["mutable://test/a", { v: 1 }],
  ["mutable://test/b", { v: 2 }],
]);

const ONE_OUTPUT = JSON.stringify(["mutable://test/single", { v: 1 }]);

// ── bnd send ──────────────────────────────────────────────────────────────────

Deno.test("bnd send <file> accepted → ✓ lines per output, exit 0", async () => {
  await withTempHome(async (home) => {
    await withTempFile(TWO_OUTPUTS, async (file) => {
      const { stdout, code } = await runBnd(
        ["send", file, "--rig", TEST_RIG],
        { env: rigEnv(home, "ok") },
      );
      assertEquals(code, 0);
      assertStringIncludes(stdout, "✓ mutable://test/a");
      assertStringIncludes(stdout, "✓ mutable://test/b");
    });
  });
});

Deno.test("bnd send <file> rejected → ✗ lines, exit 1", async () => {
  await withTempHome(async (home) => {
    await withTempFile(TWO_OUTPUTS, async (file) => {
      const { stderr, code } = await runBnd(
        ["send", file, "--rig", TEST_RIG],
        { env: rigEnv(home, "reject") },
      );
      assertEquals(code, 1);
      assertStringIncludes(stderr, "✗ mutable://test/a");
      assertStringIncludes(stderr, "rejected by test rig");
    });
  });
});

Deno.test("bnd send - (single JSON on stdin) → ✓ line, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["send", "-", "--rig", TEST_RIG],
      { env: rigEnv(home, "ok"), stdin: ONE_OUTPUT },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "✓ mutable://test/single");
  });
});

Deno.test("bnd send - (NDJSON on stdin) → ✓ per line, exit 0", async () => {
  await withTempHome(async (home) => {
    const ndjson = [
      JSON.stringify(["mutable://test/x", 1]),
      JSON.stringify(["mutable://test/y", 2]),
    ].join("\n");
    const { stdout, code } = await runBnd(
      ["send", "-", "--rig", TEST_RIG],
      { env: rigEnv(home, "ok"), stdin: ndjson },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "✓ mutable://test/x");
    assertStringIncludes(stdout, "✓ mutable://test/y");
  });
});

// ── bnd receive ───────────────────────────────────────────────────────────────

Deno.test("bnd receive <file> accepted → ✓ lines, exit 0", async () => {
  await withTempHome(async (home) => {
    await withTempFile(TWO_OUTPUTS, async (file) => {
      const { stdout, code } = await runBnd(
        ["receive", file, "--rig", TEST_RIG],
        { env: rigEnv(home, "ok") },
      );
      assertEquals(code, 0);
      assertStringIncludes(stdout, "✓ mutable://test/a");
      assertStringIncludes(stdout, "✓ mutable://test/b");
    });
  });
});

Deno.test("bnd receive <file> rejected → ✗ lines, exit 1", async () => {
  await withTempHome(async (home) => {
    await withTempFile(TWO_OUTPUTS, async (file) => {
      const { stderr, code } = await runBnd(
        ["receive", file, "--rig", TEST_RIG],
        { env: rigEnv(home, "reject") },
      );
      assertEquals(code, 1);
      assertStringIncludes(stderr, "✗ mutable://test/a");
    });
  });
});

Deno.test("bnd receive - (stdin) → ✓ line, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["receive", "-", "--rig", TEST_RIG],
      { env: rigEnv(home, "ok"), stdin: ONE_OUTPUT },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "✓ mutable://test/single");
  });
});
