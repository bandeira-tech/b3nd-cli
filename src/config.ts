import { ensureDir } from "@std/fs";
import { join } from "@std/path";

// Read HOME per-call so tests (and any runtime HOME swap) work correctly.
function configDir(): string {
  return join(Deno.env.get("HOME") || ".", ".bnd");
}

function configFile(): string {
  return join(configDir(), "config.toml");
}

export interface BndConfig {
  node?: string;
  account?: string;
  encrypt?: string; // "true" or "false"
  rig?: string; // path or URL to default rig module (v0.3+)
}

/**
 * Parse a simple TOML format config file
 */
export function parseToml(content: string): BndConfig {
  const config: BndConfig = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const stringMatch = trimmed.match(/^(\w+)\s*=\s*"([^"]*)"/);
    if (stringMatch) {
      const [, key, value] = stringMatch;
      if (key === "node") config.node = value;
      if (key === "account") config.account = value;
      if (key === "encrypt") config.encrypt = value;
      if (key === "rig") config.rig = value;
      continue;
    }

    const boolMatch = trimmed.match(/^(\w+)\s*=\s*(true|false)/);
    if (boolMatch) {
      const [, key, value] = boolMatch;
      if (key === "encrypt") config.encrypt = value;
    }
  }

  return config;
}

/**
 * Serialize config to TOML format
 */
export function serializeToml(config: BndConfig): string {
  const lines: string[] = [];
  if (config.rig) lines.push(`rig = "${config.rig}"`);
  if (config.node) lines.push(`node = "${config.node}"`);
  if (config.account) lines.push(`account = "${config.account}"`);
  if (config.encrypt) lines.push(`encrypt = "${config.encrypt}"`);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/**
 * Load configuration from ~/.bnd/config.toml
 */
export async function loadConfig(): Promise<BndConfig> {
  try {
    const content = await Deno.readTextFile(configFile());
    return parseToml(content);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return {};
    }
    throw e;
  }
}

/**
 * Save configuration to ~/.bnd/config.toml
 */
export async function saveConfig(config: BndConfig): Promise<void> {
  await ensureDir(configDir());
  const content = serializeToml(config);
  await Deno.writeTextFile(configFile(), content);
}

/**
 * Update a single config value
 */
export async function updateConfig(
  key: keyof BndConfig,
  value: string,
): Promise<void> {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
  console.log(`✓ Set ${key} = ${value}`);
  console.log(`  Config saved to ${configFile()}`);
}

/**
 * Get config file path (for display purposes)
 */
export function getConfigPath(): string {
  return configFile();
}
