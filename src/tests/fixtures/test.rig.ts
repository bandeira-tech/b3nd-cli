/**
 * Minimal in-memory rig for CLI integration tests.
 * Behavior is controlled by the B3ND_TEST_MODE env var:
 *   ok (default) — all operations succeed
 *   reject       — send/receive reject every item
 *   missing      — read returns not-found for every URI
 *   degraded     — status reports degraded
 *   unhealthy    — status reports unhealthy
 */

type Mode = "ok" | "reject" | "missing" | "degraded" | "unhealthy";

const mode = (Deno.env.get("B3ND_TEST_MODE") ?? "ok") as Mode;

type Batch = [string, unknown][];
type SendResult = { accepted: boolean; uri: string; error?: string };
type ReadResult = {
  success: boolean;
  uri: string;
  record?: { data: unknown };
  error?: string;
};
type StatusResult = {
  status: string;
  message: string;
  details?: Record<string, unknown>;
  schema?: string[];
};

const rig = {
  send(batch: Batch): SendResult[] {
    if (mode === "reject") {
      return batch.map(([uri]) => ({
        accepted: false,
        uri,
        error: "rejected by test rig",
      }));
    }
    return batch.map(([uri]) => ({ accepted: true, uri }));
  },

  receive(batch: Batch): SendResult[] {
    if (mode === "reject") {
      return batch.map(([uri]) => ({
        accepted: false,
        uri,
        error: "rejected by test rig",
      }));
    }
    return batch.map(([uri]) => ({ accepted: true, uri }));
  },

  read(uris: string[]): ReadResult[] {
    if (mode === "missing") {
      return uris.map((uri) => ({ success: false, uri, error: "not found" }));
    }
    return uris.map((uri) => ({
      success: true,
      uri,
      record: { data: { value: 42 } },
    }));
  },

  async *observe(
    pattern: string,
    signal: AbortSignal,
  ): AsyncGenerator<unknown> {
    const values = [
      { uri: `${pattern}/1`, event: "first" },
      { uri: `${pattern}/2`, event: "second" },
    ];
    for (const v of values) {
      if (signal.aborted) return;
      yield v;
    }
  },

  status(): StatusResult {
    if (mode === "degraded") {
      return {
        status: "degraded",
        message: "some services are slow",
        details: { latency: "high" },
      };
    }
    if (mode === "unhealthy") {
      return {
        status: "unhealthy",
        message: "connection refused",
        details: { cause: "ECONNREFUSED" },
      };
    }
    return {
      status: "healthy",
      message: "all systems go",
      details: { version: "test" },
      schema: ["mutable://test/**"],
    };
  },
};

export default rig;
