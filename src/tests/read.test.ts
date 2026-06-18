import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { rigEnv, runBnd, TEST_RIG, withTempHome } from "./helpers.ts";

Deno.test("bnd read <uri> → uri label + payload, exit 0", async () => {
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

Deno.test("bnd read <uri> --json → JSON array of [uri, payload] tuples, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["read", "mutable://test/item", "--rig", TEST_RIG, "--json"],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    const parsed = JSON.parse(stdout);
    assert(Array.isArray(parsed));
    // Output<T> is [uri, payload]
    assertEquals(parsed[0][0], "mutable://test/item");
    assertEquals(parsed[0][1].value, 42);
  });
});

Deno.test("bnd read <uri> missing → client-encoded payload, exit 0", async () => {
  // 'missing' mode in the test rig returns [uri, { error: "not found" }].
  // The CLI no longer interprets payload semantics — what "missing" means
  // is the executing client's contract with its callers. The CLI just
  // renders the bytes verbatim and exits 0; payload-level error handling
  // is the consumer's job.
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["read", "mutable://test/missing", "--rig", TEST_RIG],
      { env: rigEnv(home, "missing") },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "mutable://test/missing:");
    assertStringIncludes(stdout, "not found");
  });
});

Deno.test("bnd read --json missing → payload echoed verbatim, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["read", "mutable://test/missing", "--rig", TEST_RIG, "--json"],
      { env: rigEnv(home, "missing") },
    );
    assertEquals(code, 0);
    const parsed = JSON.parse(stdout);
    assertEquals(parsed[0][0], "mutable://test/missing");
    assertEquals(parsed[0][1].error, "not found");
  });
});
