/**
 * Single source of truth for the bnd CLI version.
 * Reads from deno.json so bumping the version file is the only required step.
 */
import denoJson from "../deno.json" with { type: "json" };

export const VERSION: string = denoJson.version;
