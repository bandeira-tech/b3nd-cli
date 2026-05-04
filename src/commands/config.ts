/**
 * `bnd config` — manage the default rig and view current configuration.
 *
 *   bnd config                  show current config + resolved rig
 *   bnd config show             same as above
 *   bnd config rig <path|url>   set default rig
 *   bnd config edit             open resolved rig in $EDITOR
 *   bnd config init [<path>]    scaffold starter rig + set as default
 */

import { dirname, isAbsolute, resolve } from "@std/path";
import { ensureDir } from "@std/fs";
import { getConfigPath, loadConfig, updateConfig } from "../config.ts";
import { resolveRigSource } from "../rig-loader.ts";

const DEFAULT_RIG_PATH = `${Deno.env.get("HOME") ?? "."}/.bnd/rig.ts`;

export async function configShow(): Promise<void> {
  const config = await loadConfig();
  const cfgPath = getConfigPath();

  console.log(`Config: ${cfgPath}`);
  console.log("");

  const hasAny = config.rig || config.node || config.account || config.encrypt;
  if (!hasAny) {
    console.log("  (empty — run `bnd config init` to scaffold a starter rig)");
  } else {
    if (config.rig) console.log(`  rig     = ${config.rig}`);
    if (config.node) console.log(`  node    = ${config.node}    (legacy)`);
    if (config.account) {
      console.log(`  account = ${config.account}    (legacy)`);
    }
    if (config.encrypt) {
      console.log(`  encrypt = ${config.encrypt}    (legacy)`);
    }
  }

  console.log("");
  try {
    const resolved = await resolveRigSource({
      cwd: Deno.cwd(),
      configRig: config.rig,
    });
    console.log(`Resolved rig: ${resolved.input}`);
    console.log(`  origin: ${resolved.origin}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    console.log(`Resolved rig: (none — ${msg})`);
  }
}

export async function configSetRig(input: string): Promise<void> {
  const stored = isImportSpecifier(input) || isAbsolute(input)
    ? input
    : resolve(input);
  await updateConfig("rig", stored);
}

export async function configEdit(): Promise<void> {
  const config = await loadConfig();
  const resolved = await resolveRigSource({
    cwd: Deno.cwd(),
    configRig: config.rig,
  });

  if (!resolved.input.startsWith("/") && !resolved.input.match(/^file:/)) {
    // Remote spec (jsr:, https:, npm:, etc.) — nothing to open locally.
    throw new Error(
      `Cannot edit remote rig: ${resolved.input}\n` +
        `  Edit your local copy or set a file path with: bnd config rig <path>`,
    );
  }

  const filePath = resolved.input.startsWith("file:")
    ? new URL(resolved.input).pathname
    : resolved.input;

  const editor = Deno.env.get("EDITOR") ?? Deno.env.get("VISUAL");
  if (!editor) {
    console.error("No $EDITOR or $VISUAL set.");
    console.error(`Rig file: ${filePath}`);
    Deno.exit(1);
  }

  const parts = editor.split(/\s+/);
  const cmd = new Deno.Command(parts[0], {
    args: [...parts.slice(1), filePath],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await cmd.spawn().status;
  if (!status.success) {
    throw new Error(`Editor exited with code ${status.code}`);
  }
}

export async function configInit(targetPath?: string): Promise<void> {
  const finalPath = targetPath
    ? (isAbsolute(targetPath) ? targetPath : resolve(targetPath))
    : DEFAULT_RIG_PATH;

  try {
    await Deno.stat(finalPath);
    throw new Error(
      `File already exists: ${finalPath}\n` +
        `  Edit it with: bnd config edit\n` +
        `  Or remove it first.`,
    );
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  const templateUrl = new URL("../templates/starter.rig.ts", import.meta.url);
  const template = await Deno.readTextFile(templateUrl);

  await ensureDir(dirname(finalPath));
  await Deno.writeTextFile(finalPath, template);
  console.log(`✓ Created ${finalPath}`);

  await updateConfig("rig", finalPath);
  console.log(`  Edit it with: bnd config edit`);
}

function isImportSpecifier(s: string): boolean {
  return /^(jsr|npm|https?|file):/i.test(s);
}
