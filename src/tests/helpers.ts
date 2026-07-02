import { join } from "@std/path";

export const MAIN = new URL("../main.ts", import.meta.url).pathname;
export const TEST_RIG = new URL("./fixtures/test.rig.ts", import.meta.url)
  .pathname;

// Capture the real Deno cache dir once at module load time.
// Deno derives DENO_DIR from HOME when not set explicitly; overriding HOME in
// test subprocesses would cause npm cache misses unless we pin it here.
// Exported so that subprocess-spawning tests outside runBnd() can pin it too.
export const DENO_DIR = Deno.env.get("DENO_DIR") ?? (() => {
  const home = Deno.env.get("HOME") ?? ".";
  if (Deno.build.os === "darwin") return `${home}/Library/Caches/deno`;
  const xdgCache = Deno.env.get("XDG_CACHE_HOME") ?? `${home}/.cache`;
  return `${xdgCache}/deno`;
})();

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function runBnd(
  args: string[],
  opts: { env?: Record<string, string>; stdin?: string } = {},
): Promise<RunResult> {
  const env = { ...Deno.env.toObject(), DENO_DIR, ...opts.env };
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-net",
      MAIN,
      ...args,
    ],
    env,
    stdin: opts.stdin !== undefined ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });

  if (opts.stdin !== undefined) {
    const child = cmd.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(opts.stdin));
    await writer.close();
    const output = await child.output();
    return decode(output);
  }

  return decode(await cmd.output());
}

function decode(
  output: Deno.CommandOutput,
): RunResult {
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    code: output.code,
  };
}

export async function withTempHome<T>(
  fn: (home: string) => Promise<T>,
): Promise<T> {
  const home = await Deno.makeTempDir({ prefix: "bnd-test-home-" });
  try {
    return await fn(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

export async function withTempFile<T>(
  content: string,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(path, content);
    return await fn(path);
  } finally {
    await Deno.remove(path);
  }
}

export function rigEnv(
  home: string,
  mode?: string,
): Record<string, string> {
  const env: Record<string, string> = { HOME: home };
  if (mode) env["B3ND_TEST_MODE"] = mode;
  return env;
}

export function configPath(home: string): string {
  return join(home, ".bnd", "config.toml");
}
