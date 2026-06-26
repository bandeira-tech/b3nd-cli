/**
 * Minimal in-memory rig for CLI integration tests.
 * Behavior is controlled by the B3ND_TEST_MODE env var:
 *   ok (default) — all operations succeed
 *   reject       — send/receive reject every item
 *   missing      — read returns a "not found" payload for every locator
 *   degraded     — status reports degraded
 *   unhealthy    — status reports unhealthy
 *
 * Shape matches `@bandeira-tech/b3nd-core` 0.24:
 *   send/receive return ReceiveResult[] (just {accepted, error?}, no uri)
 *   read returns Output<T>[] (= [uri, payload][])
 *   observe yields readonly string[] (batches of fired URIs)
 */

type Mode = "ok" | "reject" | "missing" | "degraded" | "unhealthy";

const mode = (Deno.env.get("B3ND_TEST_MODE") ?? "ok") as Mode;

type Output<T = unknown> = [string, T];
type ReceiveResult = { accepted: boolean; error?: string };
type StatusResult = {
  status: string;
  message: string;
  details?: Record<string, unknown>;
  schema?: string[];
};

const rig = {
  send(batch: Output[]): ReceiveResult[] {
    if (mode === "reject") {
      return batch.map(() => ({
        accepted: false,
        error: "rejected by test rig",
      }));
    }
    return batch.map(() => ({ accepted: true }));
  },

  receive(batch: Output[]): ReceiveResult[] {
    if (mode === "reject") {
      return batch.map(() => ({
        accepted: false,
        error: "rejected by test rig",
      }));
    }
    return batch.map(() => ({ accepted: true }));
  },

  read(locators: string[]): Output[] {
    if (mode === "missing") {
      return locators.map((uri) => [uri, { error: "not found" }] as Output);
    }
    return locators.map((uri) => [uri, { value: 42 }] as Output);
  },

  async *observe(
    locators: string[],
    signal: AbortSignal,
  ): AsyncGenerator<readonly string[]> {
    const base = locators[0] ?? "test://";
    const batches: string[][] = [[`${base}/1`], [`${base}/2`]];
    for (const batch of batches) {
      if (signal.aborted) return;
      yield batch;
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
