import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "@std/assert";
import { rigEnv, runBnd, TEST_RIG, withTempHome } from "./helpers.ts";

Deno.test("bnd read <uri> → uri label + data, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["read", "mutable://test/item", "--rig", TEST_RIG],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "mutable://test/item:");
    assertStringIncludes(stdout, "42"); // { value: 42 } from test rig
  });
});

Deno.test("bnd read <uri1> <uri2> → both results, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["read", "mutable://test/a", "mutable://test/b", "--rig", TEST_RIG],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "mutable://test/a:");
    assertStringIncludes(stdout, "mutable://test/b:");
  });
});

Deno.test("bnd read <uri> --json → valid JSON array on stdout, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["read", "mutable://test/item", "--rig", TEST_RIG, "--json"],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    const parsed = JSON.parse(stdout);
    assert(Array.isArray(parsed));
    assertEquals(parsed[0].uri, "mutable://test/item");
    assertEquals(parsed[0].success, true);
  });
});

Deno.test("bnd read <uri> not found → ✗ line on stderr, exit 1", async () => {
  await withTempHome(async (home) => {
    const { stderr, code } = await runBnd(
      ["read", "mutable://test/missing", "--rig", TEST_RIG],
      { env: rigEnv(home, "missing") },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "✗ mutable://test/missing");
    assertStringIncludes(stderr, "not found");
  });
});

Deno.test("bnd read --json not found → JSON with success:false, exit 1", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["read", "mutable://test/missing", "--rig", TEST_RIG, "--json"],
      { env: rigEnv(home, "missing") },
    );
    assertEquals(code, 1);
    const parsed = JSON.parse(stdout);
    assertEquals(parsed[0].success, false);
  });
});
