/**
 * Rig resolution + loading for the bnd CLI.
 *
 * Every command that needs a rig (send/receive/read/observe/node) goes
 * through here. The CLI never builds a rig itself — it imports a user
 * module that exports one.
 *
 * Resolution order:
 *   1. Explicit `--rig <path|url>`
 *   2. ./b3nd.rig.ts (or .js) in CWD
 *   3. `rig = ...` in ~/.bnd/config.toml
 *   4. Error
 *
 * Module convention (duck-typed default export):
 *   export default rig;                     // a Rig instance
 *   export default () => rig;               // sync factory
 *   export default async (env) => rig;      // async factory; receives Deno.env.toObject()
 */

import { isAbsolute, join, resolve } from "@std/path";
import { toFileUrl } from "@std/path";

export type RigOrigin = "explicit" | "project" | "config";

export interface ResolvedSource {
  /** Absolute file URL or remote URL ready to pass to dynamic import. */
  url: string;
  /** Original input as the user wrote it (for error messages). */
  input: string;
  origin: RigOrigin;
}

export interface RigLike {
  send: (...args: unknown[]) => unknown;
  receive: (...args: unknown[]) => unknown;
  read: (...args: unknown[]) => unknown;
}

export interface LoadedRig {
  rig: RigLike;
  source: ResolvedSource;
}

const PROJECT_FILES = ["b3nd.rig.ts", "b3nd.rig.js"] as const;

/**
 * Resolve which rig source to use without loading it.
 * Pure: takes its inputs explicitly, no global state.
 */
export async function resolveRigSource(opts: {
  explicit?: string;
  cwd: string;
  configRig?: string;
}): Promise<ResolvedSource> {
  if (opts.explicit) {
    return {
      url: toImportUrl(opts.explicit, opts.cwd),
      input: opts.explicit,
      origin: "explicit",
    };
  }

  const projectPath = await findProjectRig(opts.cwd);
  if (projectPath) {
    return {
      url: toFileUrl(projectPath).href,
      input: projectPath,
      origin: "project",
    };
  }

  if (opts.configRig) {
    return {
      url: toImportUrl(opts.configRig, opts.cwd),
      input: opts.configRig,
      origin: "config",
    };
  }

  throw new Error(
    "No rig configured.\n" +
      "  Run `bnd config init` to create one, or pass `--rig <path>`.",
  );
}

/**
 * Resolve and import a rig module, returning the constructed rig.
 */
export async function loadRig(opts: {
  explicit?: string;
  cwd?: string;
  configRig?: string;
}): Promise<LoadedRig> {
  const source = await resolveRigSource({
    explicit: opts.explicit,
    cwd: opts.cwd ?? Deno.cwd(),
    configRig: opts.configRig,
  });

  // Cache-bust so a re-run picks up edits without process restart caches.
  const url = source.url + (source.url.includes("?") ? "&" : "?") +
    `t=${Date.now()}`;

  let mod: { default?: unknown };
  try {
    mod = await import(url);
  } catch (e) {
    throw new Error(
      `Failed to import rig from ${source.input}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  if (mod.default === undefined) {
    throw new Error(
      `Rig module ${source.input} has no default export.\n` +
        `  Expected: export default rig | (env) => rig | async (env) => rig`,
    );
  }

  const exported = mod.default;
  let rig: unknown;
  if (typeof exported === "function") {
    rig = await (exported as (env: Record<string, string>) => unknown)(
      Deno.env.toObject(),
    );
  } else {
    rig = exported;
  }

  if (!isRigLike(rig)) {
    throw new Error(
      `Rig module ${source.input} default export is not a Rig.\n` +
        `  Expected an object with send / receive / read methods.`,
    );
  }

  return { rig, source };
}

/** Duck-type check — avoids coupling to a specific b3nd-core version. */
export function isRigLike(x: unknown): x is RigLike {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r.send === "function" &&
    typeof r.receive === "function" &&
    typeof r.read === "function";
}

async function findProjectRig(cwd: string): Promise<string | null> {
  for (const name of PROJECT_FILES) {
    const path = join(cwd, name);
    try {
      const stat = await Deno.stat(path);
      if (stat.isFile) return path;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  return null;
}

/**
 * Turn a user-supplied rig location into a URL suitable for dynamic import.
 * - Remote URL schemes (jsr:, npm:, https:, http:, file:) pass through.
 * - Bare paths resolve against `cwd` and become file:// URLs.
 */
export function toImportUrl(input: string, cwd: string): string {
  if (/^(jsr|npm|https?|file):/i.test(input)) return input;
  const abs = isAbsolute(input) ? input : resolve(cwd, input);
  return toFileUrl(abs).href;
}
