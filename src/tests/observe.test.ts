import { assertEquals, assertStringIncludes } from "@std/assert";
import { rigEnv, runBnd, TEST_RIG, withTempHome } from "./helpers.ts";

Deno.test("bnd observe <pattern> → prints fired URIs, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["observe", "mutable://test", "--rig", TEST_RIG],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    // test rig yields two batches: ["mutable://test/1"], ["mutable://test/2"]
    assertStringIncludes(stdout, "mutable://test/1");
    assertStringIncludes(stdout, "mutable://test/2");
  });
});

Deno.test("bnd observe <pattern> --json → JSON-encoded URI lines, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["observe", "mutable://test", "--rig", TEST_RIG, "--json"],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
    assertEquals(lines.length, 2);
    assertEquals(JSON.parse(lines[0]), "mutable://test/1");
    assertEquals(JSON.parse(lines[1]), "mutable://test/2");
  });
});
