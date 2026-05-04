import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { normalize, parseOutputStream, type ReadyOutput } from "./io.ts";

Deno.test("normalize: single [string, any] wraps to one-item array", () => {
  assertEquals(
    normalize(["mutable://x", { v: 1 }]),
    [["mutable://x", { v: 1 }]],
  );
});

Deno.test("normalize: array of [string, any] passes through", () => {
  const input: ReadyOutput[] = [
    ["mutable://a", 1],
    ["mutable://b", "two"],
    ["hash://sha256/x", { blob: true }],
  ];
  assertEquals(normalize(input), input);
});

Deno.test("normalize: payload that is itself an array stays a single output", () => {
  // [string, any[]] is still [string, any] — payload is the array
  assertEquals(
    normalize(["mutable://x", ["a", "b", "c"]]),
    [["mutable://x", ["a", "b", "c"]]],
  );
});

Deno.test("normalize: payload null is allowed (delete convention)", () => {
  assertEquals(normalize(["mutable://x", null]), [["mutable://x", null]]);
});

Deno.test("normalize: rejects non-array root", () => {
  assertThrows(() => normalize({ uri: "x" }), Error, "Expected");
  assertThrows(() => normalize("x"), Error, "Expected");
  assertThrows(() => normalize(42), Error, "Expected");
  assertThrows(() => normalize(null), Error, "Expected");
});

Deno.test("normalize: rejects empty array", () => {
  assertThrows(() => normalize([]), Error, "empty array");
});

Deno.test("normalize: rejects array of bad items", () => {
  assertThrows(
    () => normalize([["mutable://a", 1], ["only-one-element"]]),
    Error,
    "Invalid output",
  );
  assertThrows(
    () => normalize([[42, "payload"]]),
    Error,
    "Invalid output",
  );
});

// ── parseOutputStream (NDJSON vs buffered auto-detect) ───────────────────

async function* fromChunks(...chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
}

async function collect(
  iter: AsyncIterable<ReadyOutput[]>,
): Promise<ReadyOutput[][]> {
  const out: ReadyOutput[][] = [];
  for await (const b of iter) out.push(b);
  return out;
}

Deno.test("parseOutputStream: NDJSON yields one batch per line", async () => {
  const out = await collect(parseOutputStream(fromChunks(
    `["mutable://a",1]\n`,
    `["mutable://b",2]\n`,
    `["mutable://c",3]\n`,
  )));
  assertEquals(out, [
    [["mutable://a", 1]],
    [["mutable://b", 2]],
    [["mutable://c", 3]],
  ]);
});

Deno.test("parseOutputStream: NDJSON tolerates final line without newline", async () => {
  const out = await collect(parseOutputStream(fromChunks(
    `["mutable://a",1]\n`,
    `["mutable://b",2]`,
  )));
  assertEquals(out, [[["mutable://a", 1]], [["mutable://b", 2]]]);
});

Deno.test("parseOutputStream: NDJSON skips blank lines", async () => {
  const out = await collect(parseOutputStream(fromChunks(
    `\n\n["mutable://a",1]\n\n["mutable://b",2]\n\n`,
  )));
  assertEquals(out, [[["mutable://a", 1]], [["mutable://b", 2]]]);
});

Deno.test("parseOutputStream: buffered mode for pretty-printed multiline JSON", async () => {
  const out = await collect(parseOutputStream(fromChunks(
    `[\n`,
    `  ["mutable://a", 1],\n`,
    `  ["mutable://b", 2]\n`,
    `]\n`,
  )));
  assertEquals(out, [[["mutable://a", 1], ["mutable://b", 2]]]);
});

Deno.test("parseOutputStream: buffered mode for single output spread on lines", async () => {
  const out = await collect(parseOutputStream(fromChunks(
    `[\n`,
    `  "mutable://x",\n`,
    `  { "v": 1 }\n`,
    `]\n`,
  )));
  assertEquals(out, [[["mutable://x", { v: 1 }]]]);
});

Deno.test("parseOutputStream: chunk boundaries don't matter", async () => {
  const json = `["mutable://a",1]\n["mutable://b",2]\n`;
  // arbitrary cut points
  const out = await collect(parseOutputStream(fromChunks(
    json.slice(0, 5),
    json.slice(5, 12),
    json.slice(12),
  )));
  assertEquals(out, [[["mutable://a", 1]], [["mutable://b", 2]]]);
});

Deno.test("parseOutputStream: empty input yields nothing", async () => {
  const out = await collect(parseOutputStream(fromChunks()));
  assertEquals(out, []);
});

Deno.test("parseOutputStream: only whitespace yields nothing", async () => {
  const out = await collect(parseOutputStream(fromChunks(`\n\n   \n`)));
  assertEquals(out, []);
});

Deno.test("parseOutputStream: NDJSON with bad line throws clearly", async () => {
  await assertRejects(
    () =>
      collect(parseOutputStream(fromChunks(
        `["mutable://a",1]\n`,
        `not json\n`,
      ))),
    Error,
    "Invalid NDJSON line",
  );
});

Deno.test("parseOutputStream: NDJSON each line may itself be a batch", async () => {
  // A line that's an array-of-outputs is normalized as a batch
  const out = await collect(parseOutputStream(fromChunks(
    `[["mutable://a",1],["mutable://b",2]]\n`,
    `["mutable://c",3]\n`,
  )));
  assertEquals(out, [
    [["mutable://a", 1], ["mutable://b", 2]],
    [["mutable://c", 3]],
  ]);
});

Deno.test("parseOutputStream: first line is valid JSON of wrong shape → propagates normalize error (no silent buffered fallback)", async () => {
  // Regression: an earlier version's wide try/catch silently flipped
  // to buffered mode when normalize() threw, producing confusing
  // "Invalid JSON in stdin" errors for what should be a clear
  // "Expected [string, any]" message.
  await assertRejects(
    () =>
      collect(parseOutputStream(fromChunks(
        `{"not":"an output tuple"}\n`,
        `{"another":"object"}\n`,
      ))),
    Error,
    "Expected [string, any]",
  );
});
