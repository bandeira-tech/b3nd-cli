/**
 * Reading ready outputs for `bnd send` / `bnd receive`.
 *
 * Wire format (JSON):
 *   [string, any]      — a single output
 *   [string, any][]    — an array of outputs
 *
 * Source can be a file path or "-" for stdin.
 */

export type ReadyOutput = [string, unknown];

export async function readOutputs(source: string): Promise<ReadyOutput[]> {
  const text = source === "-"
    ? await readAllStdin()
    : await Deno.readTextFile(source);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Invalid JSON in ${source === "-" ? "stdin" : source}: ${
        (e as Error).message
      }`,
    );
  }

  return normalize(parsed);
}

/**
 * [string, any]   → wrap as single-item array
 * [string, any][] → as-is
 * anything else   → throw
 */
export function normalize(parsed: unknown): ReadyOutput[] {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "Expected [string, any] or [string, any][] — got " +
        (Array.isArray(parsed) ? "empty array" : typeof parsed),
    );
  }

  const outputs = typeof parsed[0] === "string"
    ? [parsed as ReadyOutput]
    : (parsed as ReadyOutput[]);

  for (const item of outputs) {
    if (
      !Array.isArray(item) || item.length < 2 || typeof item[0] !== "string"
    ) {
      throw new Error(
        `Invalid output: each entry must be [string, any] — got ${
          JSON.stringify(item)
        }`,
      );
    }
  }

  return outputs;
}

async function readAllStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Deno.stdin.readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}
