import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { toFileUrl } from "@std/path";
import {
  applyCacheBust,
  isRigLike,
  loadRig,
  resolveRigSource,
  toImportUrl,
} from "./rig-loader.ts";

// ── applyCacheBust ───────────────────────────────────────────────────────

Deno.test("applyCacheBust: file: URL gets a ?t= timestamp appended", () => {
  const result = applyCacheBust("file:///path/to/rig.ts");
  assert(result.startsWith("file:///path/to/rig.ts?t="), `got: ${result}`);
  assert(/\?t=\d+$/.test(result), `timestamp not a number: ${result}`);
});

Deno.test("applyCacheBust: file: URL with existing query uses & separator", () => {
  const result = applyCacheBust("file:///path/to/rig.ts?existing=1");
  assert(result.includes("?existing=1&t="), `got: ${result}`);
});

Deno.test("applyCacheBust: jsr: URL passes through unchanged", () => {
  const url = "jsr:@scope/pkg/rig";
  assertEquals(applyCacheBust(url), url);
});

Deno.test("applyCacheBust: npm: URL passes through unchanged", () => {
  const url = "npm:some-package";
  assertEquals(applyCacheBust(url), url);
});

Deno.test("applyCacheBust: https: URL passes through unchanged", () => {
  const url = "https://example.com/rig.ts";
  assertEquals(applyCacheBust(url), url);
});

Deno.test("applyCacheBust: http: URL passes through unchanged", () => {
  const url = "http://localhost:8080/rig.ts";
  assertEquals(applyCacheBust(url), url);
});

// ── isRigLike ────────────────────────────────────────────────────────────

Deno.test("isRigLike: accepts object with send/receive/read", () => {
  assert(isRigLike({ send() {}, receive() {}, read() {} }));
});

Deno.test("isRigLike: rejects null / undefined / non-objects", () => {
  assert(!isRigLike(null));
  assert(!isRigLike(undefined));
  assert(!isRigLike("rig"));
  assert(!isRigLike(42));
});

Deno.test("isRigLike: rejects when any required method is missing", () => {
  assert(!isRigLike({ send() {}, receive() {} }));
  assert(!isRigLike({ send() {}, read() {} }));
  assert(!isRigLike({ receive() {}, read() {} }));
  assert(!isRigLike({ send: 1, receive: 2, read: 3 }));
});

// ── toImportUrl ──────────────────────────────────────────────────────────

Deno.test("toImportUrl: jsr/npm/https/file specs pass through", () => {
  assertEquals(
    toImportUrl("jsr:@scope/pkg/rig", "/cwd"),
    "jsr:@scope/pkg/rig",
  );
  assertEquals(toImportUrl("npm:foo", "/cwd"), "npm:foo");
  assertEquals(
    toImportUrl("https://example.com/rig.ts", "/cwd"),
    "https://example.com/rig.ts",
  );
  assertEquals(
    toImportUrl("file:///abs/rig.ts", "/cwd"),
    "file:///abs/rig.ts",
  );
});

Deno.test("toImportUrl: relative path resolves against cwd as file URL", async () => {
  const cwd = await Deno.makeTempDir();
  const result = toImportUrl("./b3nd.rig.ts", cwd);
  assertEquals(result, toFileUrl(join(cwd, "b3nd.rig.ts")).href);
});

Deno.test("toImportUrl: absolute path becomes file URL", () => {
  assertEquals(
    toImportUrl("/abs/path/rig.ts", "/cwd"),
    "file:///abs/path/rig.ts",
  );
});

// ── resolveRigSource ─────────────────────────────────────────────────────

Deno.test("resolveRigSource: explicit wins over project + config", async () => {
  const cwd = await Deno.makeTempDir();
  await Deno.writeTextFile(join(cwd, "b3nd.rig.ts"), "// project");
  const r = await resolveRigSource({
    explicit: "jsr:@me/rig",
    cwd,
    configRig: "/from/config.ts",
  });
  assertEquals(r.origin, "explicit");
  assertEquals(r.url, "jsr:@me/rig");
  assertEquals(r.input, "jsr:@me/rig");
});

Deno.test("resolveRigSource: project file in cwd wins over config", async () => {
  const cwd = await Deno.makeTempDir();
  const projectFile = join(cwd, "b3nd.rig.ts");
  await Deno.writeTextFile(projectFile, "// project");
  const r = await resolveRigSource({ cwd, configRig: "/from/config.ts" });
  assertEquals(r.origin, "project");
  assertEquals(r.input, projectFile);
  assertEquals(r.url, toFileUrl(projectFile).href);
});

Deno.test("resolveRigSource: falls back to config when no project file", async () => {
  const cwd = await Deno.makeTempDir();
  const r = await resolveRigSource({
    cwd,
    configRig: "/from/config.ts",
  });
  assertEquals(r.origin, "config");
  assertEquals(r.input, "/from/config.ts");
  assertEquals(r.url, "file:///from/config.ts");
});

Deno.test("resolveRigSource: throws helpful error when nothing configured", async () => {
  const cwd = await Deno.makeTempDir();
  const err = await assertRejects(
    () => resolveRigSource({ cwd }),
    Error,
    "No rig configured",
  );
  assertStringIncludes(err.message, "bnd config init");
});

Deno.test("resolveRigSource: also picks up b3nd.rig.js", async () => {
  const cwd = await Deno.makeTempDir();
  const jsFile = join(cwd, "b3nd.rig.js");
  await Deno.writeTextFile(jsFile, "// project");
  const r = await resolveRigSource({ cwd });
  assertEquals(r.origin, "project");
  assertEquals(r.input, jsFile);
});

// ── loadRig (dynamic import + duck-typing) ───────────────────────────────

const STUB_RIG = `
const rig = {
  send: () => Promise.resolve([]),
  receive: () => Promise.resolve([]),
  read: () => Promise.resolve([]),
};
export default rig;
`;

const STUB_FACTORY_SYNC = `
export default () => ({
  send: () => Promise.resolve([]),
  receive: () => Promise.resolve([]),
  read: () => Promise.resolve([]),
});
`;

const STUB_FACTORY_ASYNC = `
export default async (env) => ({
  env,
  send: () => Promise.resolve([]),
  receive: () => Promise.resolve([]),
  read: () => Promise.resolve([]),
});
`;

const STUB_NO_DEFAULT =
  `export const rig = { send() {}, receive() {}, read() {} };`;

const STUB_BAD_SHAPE = `export default { foo: "bar" };`;

async function writeRig(cwd: string, content: string): Promise<string> {
  const path = join(cwd, "b3nd.rig.ts");
  await Deno.writeTextFile(path, content);
  return path;
}

Deno.test("loadRig: default export is a Rig instance", async () => {
  const cwd = await Deno.makeTempDir();
  await writeRig(cwd, STUB_RIG);
  const { rig, source } = await loadRig({ cwd });
  assert(isRigLike(rig));
  assertEquals(source.origin, "project");
});

Deno.test("loadRig: default export is a sync factory", async () => {
  const cwd = await Deno.makeTempDir();
  await writeRig(cwd, STUB_FACTORY_SYNC);
  const { rig } = await loadRig({ cwd });
  assert(isRigLike(rig));
});

Deno.test("loadRig: default export is an async factory and receives env", async () => {
  const cwd = await Deno.makeTempDir();
  await writeRig(cwd, STUB_FACTORY_ASYNC);
  Deno.env.set("BND_TEST_ENV_PROBE", "ok");
  try {
    const { rig } = await loadRig({ cwd });
    assert(isRigLike(rig));
    assertEquals(
      (rig as unknown as { env: Record<string, string> }).env
        .BND_TEST_ENV_PROBE,
      "ok",
    );
  } finally {
    Deno.env.delete("BND_TEST_ENV_PROBE");
  }
});

Deno.test("loadRig: missing default export throws", async () => {
  const cwd = await Deno.makeTempDir();
  await writeRig(cwd, STUB_NO_DEFAULT);
  await assertRejects(() => loadRig({ cwd }), Error, "no default export");
});

Deno.test("loadRig: default export not rig-shaped throws", async () => {
  const cwd = await Deno.makeTempDir();
  await writeRig(cwd, STUB_BAD_SHAPE);
  await assertRejects(() => loadRig({ cwd }), Error, "not a Rig");
});
