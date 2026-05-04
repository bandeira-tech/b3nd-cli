/**
 * Reading ready outputs for `bnd send` / `bnd receive`.
 *
 * Wire format (JSON):
 *   [string, any]      — a single output
 *   [string, any][]    — an array of outputs
 *
 * Source can be a file path (read+parsed as one JSON value) or "-" for
 * stdin. Stdin auto-detects between two modes:
 *
 *   NDJSON streaming  — first non-empty line parses as JSON on its own.
 *                        Each subsequent line is parsed and emitted as
 *                        a separate batch. Pipe-friendly, low-latency.
 *
 *   Buffered single-JSON — first line doesn't parse standalone (e.g.
 *                          a pretty-printed multi-line JSON object).
 *                          Read everything, parse once at EOF.
 *
 * This makes `bnd observe pat --json | bnd receive -` just work, while
 * still accepting `cat file.json | bnd send -`.
 */

export type ReadyOutput = [string, unknown];

/**
 * Stream batches of outputs from a source. Yields one batch per
 * arrival; for files always one batch, for stdin one or many.
 */
export async function* streamOutputs(
  source: string,
): AsyncIterable<ReadyOutput[]> {
  if (source !== "-") {
    yield await readOutputs(source);
    return;
  }
  yield* parseOutputStream(stdinChunks());
}

/**
 * One-shot read (file or full stdin buffer). Kept for callers that
 * specifically need a single batch — most send/receive paths should
 * use streamOutputs instead.
 */
export async function readOutputs(source: string): Promise<ReadyOutput[]> {
  const text = source === "-"
    ? await readAllStdin()
    : await Deno.readTextFile(source);
  return parseOneJson(text, source === "-" ? "stdin" : source);
}

/**
 * Pure parser/dispatcher used by streamOutputs. Takes any AsyncIterable
 * of decoded text chunks (no IO dependency — easy to unit-test). Auto-
 * detects NDJSON vs buffered single-JSON on the first non-empty line.
 */
export async function* parseOutputStream(
  chunks: AsyncIterable<string>,
): AsyncIterable<ReadyOutput[]> {
  let buf = "";
  let mode: "ndjson" | "buffered" | null = null;

  for await (const chunk of chunks) {
    buf += chunk;

    // First-line detection
    while (mode === null) {
      const nl = buf.indexOf("\n");
      if (nl === -1) break; // need more data
      const line = buf.slice(0, nl).trim();
      if (line.length === 0) {
        buf = buf.slice(nl + 1);
        continue; // skip leading blank lines
      }
      // Only the JSON.parse step decides mode. If parse succeeds we're
      // in NDJSON; normalize errors after that are real shape errors
      // and must propagate (don't silently fall back to buffered).
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        mode = "buffered";
        break;
      }
      mode = "ndjson";
      yield normalize(parsed);
      buf = buf.slice(nl + 1);
      break;
    }

    // NDJSON: yield every complete line we have buffered
    if (mode === "ndjson") {
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        yield normalize(parseLine(line));
      }
    }
  }

  // EOF — handle any remainder
  const rest = buf.trim();
  if (rest.length === 0) return;

  if (mode === "ndjson") {
    yield normalize(parseLine(rest));
  } else {
    // Either buffered mode (first line failed standalone) or we never
    // even saw a newline. Either way, treat the whole buffer as one JSON.
    yield parseOneJson(rest, "stdin");
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (e) {
    throw new Error(
      `Invalid NDJSON line: ${truncate(line, 80)} — ${(e as Error).message}`,
    );
  }
}

function parseOneJson(text: string, src: string): ReadyOutput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${src}: ${(e as Error).message}`);
  }
  return normalize(parsed);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
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

async function* stdinChunks(): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const reader = Deno.stdin.readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush decoder
        const tail = decoder.decode();
        if (tail) yield tail;
        return;
      }
      const text = decoder.decode(value, { stream: true });
      if (text) yield text;
    }
  } finally {
    reader.releaseLock();
  }
}

async function readAllStdin(): Promise<string> {
  let out = "";
  for await (const c of stdinChunks()) out += c;
  return out;
}
