import { assertEquals, assertStringIncludes } from "@std/assert";
import { rigEnv, runBnd, TEST_RIG, withTempHome } from "./helpers.ts";

Deno.test("bnd status healthy → ✓ prefix, message, details, schema", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["status", "--rig", TEST_RIG],
      { env: rigEnv(home, "ok") },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "✓ healthy");
    assertStringIncludes(stdout, "all systems go");
    assertStringIncludes(stdout, "version");
    assertStringIncludes(stdout, "mutable://test/**");
  });
});

Deno.test("bnd status degraded → ~ prefix, message, details", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["status", "--rig", TEST_RIG],
      { env: rigEnv(home, "degraded") },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "~ degraded");
    assertStringIncludes(stdout, "some services are slow");
    assertStringIncludes(stdout, "latency");
  });
});

Deno.test("bnd status unhealthy → ✗ prefix, message", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(
      ["status", "--rig", TEST_RIG],
      { env: rigEnv(home, "unhealthy") },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "✗ unhealthy");
    assertStringIncludes(stdout, "connection refused");
  });
});

Deno.test("bnd status --verbose shows rig source on stderr", async () => {
  await withTempHome(async (home) => {
    const { stderr, code } = await runBnd(
      ["status", "--rig", TEST_RIG, "--verbose"],
      { env: rigEnv(home) },
    );
    assertEquals(code, 0);
    assertStringIncludes(stderr, "Rig:");
  });
});
