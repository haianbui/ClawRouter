/**
 * FreeRouter Auth — loads API keys from Clawdbot config + macOS Keychain
 * Adapted for Clawdbot's setup
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "./logger.js";

export type ProviderAuth = {
  provider: string;
  profileName: string;
  token?: string;   // Anthropic API key or OAuth token
  apiKey?: string;   // API key (OpenAI, etc.)
};

type ClawdbotConfig = {
  auth?: {
    profiles?: Record<string, {
      provider: string;
      mode: "token" | "api_key" | "oauth";
      email?: string;
    }>;
  };
  skills?: {
    entries?: Record<string, {
      apiKey?: string;
    }>;
  };
};

let authCache: Map<string, ProviderAuth> | null = null;

/**
 * Read Anthropic token from macOS Keychain (Claude Code storage)
 */
function getAnthropicTokenFromKeychain(): string | undefined {
  try {
    const result = execSync('security find-generic-password -s "Claude Code" -w 2>/dev/null', {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    
    if (result && result.startsWith("sk-ant-")) {
      logger.info("Loaded Anthropic token from macOS Keychain");
      return result;
    }
  } catch {
    // Keychain access failed or not on macOS
  }
  return undefined;
}

/**
 * Read Anthropic token from environment or Claude CLI files
 */
function getAnthropicTokenFromEnvOrFiles(): string | undefined {
  // Environment variables
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (process.env.ANTHROPIC_AUTH_TOKEN) return process.env.ANTHROPIC_AUTH_TOKEN;
  if (process.env.CLAUDE_CODE_TOKEN) return process.env.CLAUDE_CODE_TOKEN;

  // Try reading from Claude CLI's credential files
  const possiblePaths = [
    join(homedir(), ".claude", "credentials.json"),
    join(homedir(), ".config", "claude", "credentials.json"),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, "utf-8"));
        if (data.token) return data.token;
        if (data.claudeAiOauth?.accessToken) return data.claudeAiOauth.accessToken;
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}

function loadAuthProfiles(): Map<string, ProviderAuth> {
  const configPath = join(homedir(), ".clawdbot", "clawdbot.json");
  const map = new Map<string, ProviderAuth>();

  // Try keychain first (most reliable on macOS)
  const keychainToken = getAnthropicTokenFromKeychain();
  if (keychainToken) {
    map.set("anthropic", {
      provider: "anthropic",
      profileName: "keychain",
      token: keychainToken,
    });
  }

  // Fall back to environment/files if keychain didn't work
  if (!map.has("anthropic")) {
    const envToken = getAnthropicTokenFromEnvOrFiles();
    if (envToken) {
      map.set("anthropic", {
        provider: "anthropic",
        profileName: "env",
        token: envToken,
      });
    }
  }

  // Try to read Clawdbot config for OpenAI keys
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      const config: ClawdbotConfig = JSON.parse(raw);

      // Check for OpenAI key in skills (openai-whisper-api or openai-image-gen)
      if (config.skills?.entries) {
        for (const [skillName, skillConfig] of Object.entries(config.skills.entries)) {
          if (skillName.includes("openai") && skillConfig.apiKey) {
            if (!map.has("openai")) {
              map.set("openai", {
                provider: "openai",
                profileName: skillName,
                apiKey: skillConfig.apiKey,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn("Could not read Clawdbot config:", err);
  }

  // Also check OpenAI env
  if (!map.has("openai") && process.env.OPENAI_API_KEY) {
    map.set("openai", {
      provider: "openai",
      profileName: "env",
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  logger.info(`Loaded auth for providers: ${[...map.keys()].join(", ") || "none"}`);
  return map;
}

export function getAuth(provider: string): ProviderAuth | undefined {
  if (!authCache) {
    authCache = loadAuthProfiles();
  }
  return authCache.get(provider);
}

export function reloadAuth(): void {
  authCache = null;
  logger.info("Auth cache cleared, will reload on next access");
}

/**
 * Get the authorization header value for a provider.
 */
export function getAuthHeader(provider: string): string | undefined {
  const auth = getAuth(provider);
  if (!auth) return undefined;

  if (auth.token) {
    return auth.token;
  }
  if (auth.apiKey) {
    return auth.apiKey;
  }
  return undefined;
}
