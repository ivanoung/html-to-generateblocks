import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PropertyConfig {
  acceptedValues: string[];
}

interface WhitelistConfig {
  version: string;
  properties: Record<string, PropertyConfig>;
}

let _config: WhitelistConfig | null = null;

function loadConfig(): WhitelistConfig {
  if (_config) return _config;
  const configPath = resolve(__dirname, "../../config/gb-whitelist.json");
  _config = JSON.parse(readFileSync(configPath, "utf-8"));
  return _config!;
}

/** Check if property is in the GB whitelist */
export function isGbProperty(property: string): boolean {
  const config = loadConfig();
  return property in config.properties;
}

/** Validates CSS value syntax against GB-accepted types */
function isValidValueSyntax(property: string, value: string): boolean {
  if (!value || value.trim().length === 0) return false;

  // Reject CSS-wide keywords
  if (/^(inherit|initial|unset|revert|revert-layer)$/.test(value.trim())) {
    return false;
  }

  // Reject var() — GB doesn't support custom properties
  if (/\bvar\(/.test(value)) return false;

  // Reject vendor-prefixed values
  if (/^-webkit-|-moz-|-ms-|-o-/.test(value)) return false;

  // Reject GB-unsupported CSS functions
  if (/\bcolor-mix\(/.test(value)) return false;

  // Reject GB-unsupported color spaces
  if (/\boklch\(/.test(value) || /\boklab\(/.test(value) || /\blch\(/.test(value)) return false;

  // Reject calc() containing var()
  if (/\bcalc\([^)]*\bvar\(/.test(value)) return false;

  return true;
}

/**
 * Check if a camelCase property-value pair is supported by GenerateBlocks.
 * Returns true only if both the property is in the whitelist AND the value
 * syntax passes validation.
 */
export function isGbSupported(property: string, value: string): boolean {
  if (!isGbProperty(property)) return false;
  return isValidValueSyntax(property, value);
}

/** Get the accepted value types for a property */
export function getAcceptedValues(property: string): string[] | undefined {
  const config = loadConfig();
  return config.properties[property]?.acceptedValues;
}
