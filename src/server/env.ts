if (typeof globalThis !== "undefined" && globalThis.localStorage && !globalThis.localStorage.getItem) {
  try {
    delete (globalThis as any).localStorage;
  } catch (e) {
    // ignore
  }
}

import type { Env } from "@/types/contracts";

let cached: Env | null = null;

/** Parse process.env once into the typed Env contract. */
export function getEnv(): Env {
  if (cached) return cached;
  cached = {
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgres://shareteacher:shareteacher@localhost:5433/shareteacher",
    runway: {
      apiKey: process.env.RUNWAY_API_KEY || undefined,
      baseUrl: process.env.RUNWAY_BASE_URL || "https://api.dev.runwayml.com",
      characterId: process.env.RUNWAY_CHARACTER_ID || undefined,
      voiceId: process.env.RUNWAY_VOICE_ID || undefined,
    },
    recall: {
      apiKey: process.env.RECALL_API_KEY || undefined,
      region: process.env.RECALL_REGION || "ap-northeast-1",
      outputUrl: process.env.RECALL_OUTPUT_URL || "http://localhost:3000/stage",
    },
    kernel: {
      apiKey: process.env.KERNEL_API_KEY || undefined,
      baseUrl: process.env.KERNEL_BASE_URL || "https://api.onkernel.com",
      profileName: process.env.KERNEL_PROFILE_NAME || "shareteacher",
    },
    browserAgentUrl: process.env.BROWSER_AGENT_URL || "http://localhost:8700",
    openai: { apiKey: process.env.OPENAI_API_KEY || undefined },
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
  };
  return cached;
}

/** Test helper: drop the cache so a fresh getEnv() re-reads process.env. */
export function resetEnvCache(): void {
  cached = null;
}
