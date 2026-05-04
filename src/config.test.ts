import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  type BndConfig,
  getConfigPath,
  loadConfig,
  parseToml,
  saveConfig,
  serializeToml,
  updateConfig,
} from "./config.ts";

// ── parseToml ────────────────────────────────────────────────────────────

Deno.test("parseToml: empty input → empty config", () => {
  assertEquals(parseToml(""), {});
});

Deno.test("parseToml: rig key", () => {
  assertEquals(
    parseToml(`rig = "/path/to/rig.ts"`),
    { rig: "/path/to/rig.ts" },
  );
});

Deno.test("parseToml: ignores blank lines", () => {
  assertEquals(
    parseToml(`\n\nrig = "/r"\n\n`),
    { rig: "/r" },
  );
});

Deno.test("parseToml: ignores comment lines", () => {
  assertEquals(
    parseToml(`# header\nrig = "/r"\n# trailing\n`),
    { rig: "/r" },
  );
});

Deno.test("parseToml: tolerates extra whitespace around `=`", () => {
  assertEquals(parseToml(`rig    =   "/r"`), { rig: "/r" });
});

Deno.test("parseToml: unknown keys are ignored (incl. dropped legacy keys)", () => {
  assertEquals(
    parseToml(`rig = "/r"\nfuture = "value"\nnode = "/n"\nencrypt = "true"\n`),
    { rig: "/r" },
  );
});

Deno.test("parseToml: malformed lines are silently skipped", () => {
  // Hand-rolled parser doesn't error — it just keeps what matched
  assertEquals(parseToml(`rig =\nrig = "/r"`), { rig: "/r" });
});

// ── serializeToml ────────────────────────────────────────────────────────

Deno.test("serializeToml: empty config → empty string", () => {
  assertEquals(serializeToml({}), "");
});

Deno.test("serializeToml: rig key", () => {
  assertEquals(serializeToml({ rig: "/r" }), `rig = "/r"\n`);
});

Deno.test("serializeToml: ends with single trailing newline", () => {
  const out = serializeToml({ rig: "/r" });
  assertEquals(out.endsWith("\n"), true);
  assertEquals(out.endsWith("\n\n"), false);
});

// ── roundtrip ────────────────────────────────────────────────────────────

Deno.test("roundtrip: parse(serialize(x)) === x", () => {
  const samples: BndConfig[] = [
    {},
    { rig: "/r" },
    { rig: "jsr:@me/rig" },
    { rig: "https://example.com/rig.ts" },
  ];
  for (const x of samples) {
    assertEquals(parseToml(serializeToml(x)), x);
  }
});

// ── load / save / updateConfig (against an isolated HOME) ───────────────

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

Deno.test("loadConfig: returns empty when file does not exist", async () => {
  await withTempHome(async () => {
    assertEquals(await loadConfig(), {});
  });
});

Deno.test("saveConfig + loadConfig: roundtrip writes the right file", async () => {
  await withTempHome(async () => {
    const cfg: BndConfig = { rig: "/r" };
    await saveConfig(cfg);

    // The file should land at $HOME/.bnd/config.toml
    const home = Deno.env.get("HOME")!;
    const expected = join(home, ".bnd", "config.toml");
    assertEquals(getConfigPath(), expected);
    const onDisk = await Deno.readTextFile(expected);
    assertEquals(onDisk, serializeToml(cfg));

    assertEquals(await loadConfig(), cfg);
  });
});

Deno.test("updateConfig: setting an existing key overwrites it", async () => {
  await withTempHome(async () => {
    await saveConfig({ rig: "/old" });
    await updateConfig("rig", "/new");
    assertEquals((await loadConfig()).rig, "/new");
  });
});

Deno.test("getConfigPath: respects the current HOME", async () => {
  await withTempHome(() => {
    const home = Deno.env.get("HOME")!;
    assertEquals(getConfigPath(), join(home, ".bnd", "config.toml"));
    return Promise.resolve();
  });
});
