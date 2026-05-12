import { assertEquals, assertStringIncludes } from "@std/assert";
import { rigEnv, runBnd, TEST_RIG, withTempHome } from "./helpers.ts";

Deno.test("bnd observe <pattern> → pretty-prints values, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["observe", "mutable://test/**", "--rig", TEST_RIG],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    // test rig yields { uri: "mutable://test/**/1", event: "first" }
    assertStringIncludes(stdout, "first");
    assertStringIncludes(stdout, "second");
  });
});

Deno.test("bnd observe <pattern> --json → NDJSON lines, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["observe", "mutable://test/**", "--rig", TEST_RIG, "--json"],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
    assertEquals(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assertEquals(first.event, "first");
    const second = JSON.parse(lines[1]);
    assertEquals(second.event, "second");
  });
});
