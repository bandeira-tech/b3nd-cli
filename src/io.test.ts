import { assertEquals, assertThrows } from "@std/assert";
import { normalize, type ReadyOutput } from "./io.ts";

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
