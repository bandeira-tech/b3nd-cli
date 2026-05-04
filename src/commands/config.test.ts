import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { configInit, configSetRig } from "./config.ts";
import { loadConfig } from "../config.ts";

async function withTempHome<T>(fn: () => Promise<T>): Promise<T> {
  const tmp = await Deno.makeTempDir();
  const orig = Deno.env.get("HOME");
  Deno.env.set("HOME", tmp);
  try {
    return await fn();
  } finally {
    if (orig !== undefined) Deno.env.set("HOME", orig);
    else Deno.env.delete("HOME");
    await Deno.remove(tmp, { recursive: true });
  }
}

// ── configSetRig ─────────────────────────────────────────────────────────

Deno.test("configSetRig: absolute path stored as-is", async () => {
  await withTempHome(async () => {
    await configSetRig("/some/abs/rig.ts");
    assertEquals((await loadConfig()).rig, "/some/abs/rig.ts");
  });
});

Deno.test("configSetRig: import specifiers (jsr:, npm:, https:, file:) stored as-is", async () => {
  await withTempHome(async () => {
    await configSetRig("jsr:@me/rig");
    assertEquals((await loadConfig()).rig, "jsr:@me/rig");

    await configSetRig("https://example.com/rig.ts");
    assertEquals((await loadConfig()).rig, "https://example.com/rig.ts");

    await configSetRig("npm:my-rig");
    assertEquals((await loadConfig()).rig, "npm:my-rig");

    await configSetRig("file:///abs/rig.ts");
    assertEquals((await loadConfig()).rig, "file:///abs/rig.ts");
  });
});

Deno.test("configSetRig: relative path is resolved to absolute", async () => {
  await withTempHome(async () => {
    await configSetRig("./b3nd.rig.ts");
    const stored = (await loadConfig()).rig;
    assertEquals(stored?.startsWith("/"), true);
    assertEquals(stored?.endsWith("/b3nd.rig.ts"), true);
  });
});

// ── configInit ───────────────────────────────────────────────────────────

Deno.test("configInit: creates default rig file and points config at it", async () => {
  await withTempHome(async () => {
    await configInit();

    const home = Deno.env.get("HOME")!;
    const expected = join(home, ".bnd", "rig.ts");

    // file exists with template content
    const content = await Deno.readTextFile(expected);
    assertStringIncludes(content, "export default");
    assertStringIncludes(content, "createClientFromUrl");

    // config points at it
    assertEquals((await loadConfig()).rig, expected);
  });
});

Deno.test("configInit: explicit target path is used", async () => {
  await withTempHome(async () => {
    const home = Deno.env.get("HOME")!;
    const target = join(home, "custom", "place.ts");
    await configInit(target);

    const content = await Deno.readTextFile(target);
    assertStringIncludes(content, "export default");
    assertEquals((await loadConfig()).rig, target);
  });
});

Deno.test("configInit: refuses to overwrite an existing file", async () => {
  await withTempHome(async () => {
    const home = Deno.env.get("HOME")!;
    const target = join(home, "rig.ts");
    await Deno.writeTextFile(target, "// already here");
    await assertRejects(
      () => configInit(target),
      Error,
      "already exists",
    );
    // file is untouched
    assertEquals(await Deno.readTextFile(target), "// already here");
  });
});
