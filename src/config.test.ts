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

Deno.test("parseToml: each known key", () => {
  assertEquals(
    parseToml(`rig = "/path/to/rig.ts"`),
    { rig: "/path/to/rig.ts" },
  );
  assertEquals(
    parseToml(`node = "https://node.example.com"`),
    { node: "https://node.example.com" },
  );
  assertEquals(
    parseToml(`account = "/path/key"`),
    { account: "/path/key" },
  );
});

Deno.test("parseToml: all keys together", () => {
  const content = `
rig = "/r"
node = "/n"
account = "/a"
encrypt = "true"
`;
  assertEquals(parseToml(content), {
    rig: "/r",
    node: "/n",
    account: "/a",
    encrypt: "true",
  });
});

Deno.test("parseToml: ignores blank lines", () => {
  assertEquals(
    parseToml(`\n\nrig = "/r"\n\n\nnode = "/n"\n\n`),
    { rig: "/r", node: "/n" },
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

Deno.test("parseToml: encrypt accepts bare bool true/false", () => {
  assertEquals(parseToml(`encrypt = true`), { encrypt: "true" });
  assertEquals(parseToml(`encrypt = false`), { encrypt: "false" });
});

Deno.test("parseToml: unknown keys are ignored", () => {
  assertEquals(
    parseToml(`rig = "/r"\nfuture = "value"\n`),
    { rig: "/r" },
  );
});

Deno.test("parseToml: malformed lines are silently skipped", () => {
  // Hand-rolled parser doesn't error — it just keeps what matched
  assertEquals(parseToml(`rig =\nnode = "/n"`), { node: "/n" });
});

// ── serializeToml ────────────────────────────────────────────────────────

Deno.test("serializeToml: empty config → empty string", () => {
  assertEquals(serializeToml({}), "");
});

Deno.test("serializeToml: rig appears first (sorts on top)", () => {
  const out = serializeToml({ node: "/n", rig: "/r" });
  // rig must appear before node in the output
  const rigIdx = out.indexOf("rig");
  const nodeIdx = out.indexOf("node");
  assertEquals(rigIdx >= 0 && nodeIdx >= 0 && rigIdx < nodeIdx, true);
});

Deno.test("serializeToml: ends with single trailing newline", () => {
  const out = serializeToml({ rig: "/r" });
  assertEquals(out.endsWith("\n"), true);
  assertEquals(out.endsWith("\n\n"), false);
});

// ── roundtrip ────────────────────────────────────────────────────────────

Deno.test("roundtrip: parse(serialize(x)) === x for full configs", () => {
  const samples: BndConfig[] = [
    {},
    { rig: "/r" },
    { rig: "/r", node: "/n" },
    { rig: "/r", node: "/n", account: "/a", encrypt: "true" },
    { encrypt: "false" },
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
    const cfg: BndConfig = { rig: "/r", node: "/n" };
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

Deno.test("updateConfig: merges a single key without losing others", async () => {
  await withTempHome(async () => {
    await saveConfig({ node: "/n", account: "/a" });
    await updateConfig("rig", "/r");
    assertEquals(await loadConfig(), {
      node: "/n",
      account: "/a",
      rig: "/r",
    });
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
