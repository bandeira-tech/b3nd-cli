import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { configPath, runBnd, withTempHome } from "./helpers.ts";

Deno.test("bnd config (no rig set) → shows empty config message, exit 0", async () => {
  await withTempHome(async (home) => {
    const { stdout, code } = await runBnd(["config"], { env: { HOME: home } });
    assertEquals(code, 0);
    assertStringIncludes(stdout, "Config:");
    assertStringIncludes(stdout, "bnd config init");
  });
});

Deno.test("bnd config rig <path> → updates config, exit 0", async () => {
  await withTempHome(async (home) => {
    const rigPath = "/tmp/my.rig.ts";
    const { stdout, code } = await runBnd(
      ["config", "rig", rigPath],
      { env: { HOME: home } },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "✓ Set rig");
    assertStringIncludes(stdout, rigPath);

    const toml = await Deno.readTextFile(configPath(home));
    assertStringIncludes(toml, rigPath);
  });
});

Deno.test("bnd config show after setting rig → shows rig path, exit 0", async () => {
  await withTempHome(async (home) => {
    const rigPath = "/tmp/my.rig.ts";
    await runBnd(["config", "rig", rigPath], { env: { HOME: home } });

    const { stdout, code } = await runBnd(["config"], {
      env: { HOME: home },
    });
    assertEquals(code, 0);
    assertStringIncludes(stdout, rigPath);
  });
});

Deno.test("bnd config init → creates rig file, sets config, exit 0", async () => {
  await withTempHome(async (home) => {
    const rigPath = join(home, "my-rig.ts");
    const { stdout, code } = await runBnd(
      ["config", "init", rigPath],
      { env: { HOME: home } },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "✓ Created");
    assertStringIncludes(stdout, rigPath);

    const stat = await Deno.stat(rigPath);
    assert(stat.isFile);

    const toml = await Deno.readTextFile(configPath(home));
    assertStringIncludes(toml, rigPath);
  });
});

Deno.test("bnd config init when file exists → error, exit 1", async () => {
  await withTempHome(async (home) => {
    const rigPath = join(home, "existing.rig.ts");
    await Deno.writeTextFile(rigPath, "// already here");

    const { stderr, code } = await runBnd(
      ["config", "init", rigPath],
      { env: { HOME: home } },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "already exists");
  });
});
