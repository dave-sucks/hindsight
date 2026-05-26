"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { encryptAndPack, unpackAndDecrypt } from "@/lib/crypto";
import { getAccount, type AlpacaCredentials } from "@/lib/alpaca";
import { revalidatePath } from "next/cache";
import {
  listVoices,
  type ElevenLabsVoice,
} from "@/lib/podcast/elevenlabs";
import { getAccountId, getOwnerUserId, getUserRole } from "@/lib/auth/account";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getServerUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Not authenticated");
  return user.id;
}

// Alpaca keys live on UserApiKey (userId-keyed) but the trading account is
// owned by the Account. So every key lookup resolves the caller's active
// account, walks to its OWNER, and reads/writes keys against that user's
// row. EDITOR/VIEWER teammates inherit OWNER creds; key edits are
// OWNER-only (enforced in save/delete/reverify below).
async function resolveKeyOwnerUserId(callerUserId: string): Promise<string | null> {
  const accountId = await getAccountId(callerUserId);
  if (!accountId) return null;
  return getOwnerUserId(accountId);
}

async function requireOwnerForKeyMutation(): Promise<string> {
  const callerUserId = await getServerUserId();
  const accountId = await getAccountId(callerUserId);
  if (!accountId) throw new Error("No account");
  const role = await getUserRole(callerUserId, accountId);
  if (role !== "OWNER") {
    throw new Error("Only the account owner can manage API keys.");
  }
  const ownerUserId = await getOwnerUserId(accountId);
  if (!ownerUserId) throw new Error("Account has no owner");
  return ownerUserId;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlpacaEnvironment = "PAPER" | "LIVE";

export type ApiKeyStatus = {
  hasKey: boolean;
  provider: string;
  environment: AlpacaEnvironment;
  keyHint: string | null;
  verified: boolean;
  verifiedAt: string | null;
  label: string | null;
};

export type SaveApiKeyInput = {
  provider: "ALPACA";
  environment: AlpacaEnvironment;
  apiKey: string;
  apiSecret: string;
  label?: string;
  baseUrl?: string;
};

const PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const LIVE_BASE_URL = "https://api.alpaca.markets";

function defaultBaseUrl(environment: AlpacaEnvironment): string {
  return environment === "LIVE" ? LIVE_BASE_URL : PAPER_BASE_URL;
}

// ─── Get API key status (no secrets returned) ─────────────────────────────────

export async function getApiKeyStatus(
  provider: string = "ALPACA",
  environment: AlpacaEnvironment = "PAPER",
): Promise<ApiKeyStatus> {
  const callerUserId = await getServerUserId();
  const ownerUserId = await resolveKeyOwnerUserId(callerUserId);
  if (!ownerUserId) {
    return {
      hasKey: false,
      provider,
      environment,
      keyHint: null,
      verified: false,
      verifiedAt: null,
      label: null,
    };
  }
  const row = await prisma.userApiKey.findUnique({
    where: { userId_provider_environment: { userId: ownerUserId, provider, environment } },
    select: {
      provider: true,
      environment: true,
      keyHint: true,
      verified: true,
      verifiedAt: true,
      label: true,
    },
  });

  if (!row) {
    return {
      hasKey: false,
      provider,
      environment,
      keyHint: null,
      verified: false,
      verifiedAt: null,
      label: null,
    };
  }

  return {
    hasKey: true,
    provider: row.provider,
    environment: row.environment as AlpacaEnvironment,
    keyHint: row.keyHint,
    verified: row.verified,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    label: row.label,
  };
}

/** Returns both PAPER and LIVE statuses in one call for the settings page. */
export async function getAlpacaKeyStatuses(): Promise<{
  paper: ApiKeyStatus;
  live: ApiKeyStatus;
}> {
  const [paper, live] = await Promise.all([
    getApiKeyStatus("ALPACA", "PAPER"),
    getApiKeyStatus("ALPACA", "LIVE"),
  ]);
  return { paper, live };
}

// ─── Save (upsert) API key ───────────────────────────────────────────────────

export async function saveApiKey(
  input: SaveApiKeyInput
): Promise<{ success: boolean; verified: boolean; error?: string }> {
  try {
    const userId = await requireOwnerForKeyMutation();
    const baseUrl = input.baseUrl ?? defaultBaseUrl(input.environment);

    // Encrypt the credentials
    const encryptedKey = encryptAndPack(input.apiKey);
    const encryptedSecret = encryptAndPack(input.apiSecret);
    const keyHint = `...${input.apiKey.slice(-4)}`;

    // Verify by calling getAccount with these credentials
    let verified = false;
    let verifiedAt: Date | null = null;
    const creds: AlpacaCredentials = {
      keyId: input.apiKey,
      secretKey: input.apiSecret,
      baseUrl,
    };

    try {
      await getAccount(creds);
      verified = true;
      verifiedAt = new Date();
    } catch (err) {
      // Keys saved but not verified — user can still save and fix later
      console.warn("[api-keys] Alpaca verification failed:", err instanceof Error ? err.message : err);
    }

    await prisma.userApiKey.upsert({
      where: {
        userId_provider_environment: {
          userId,
          provider: input.provider,
          environment: input.environment,
        },
      },
      create: {
        userId,
        provider: input.provider,
        environment: input.environment,
        label: input.label ?? null,
        encryptedKey,
        encryptedSecret,
        keyHint,
        baseUrl,
        verified,
        verifiedAt,
      },
      update: {
        label: input.label ?? null,
        encryptedKey,
        encryptedSecret,
        keyHint,
        baseUrl,
        verified,
        verifiedAt,
      },
    });

    revalidatePath("/settings");
    return { success: true, verified };
  } catch (err) {
    console.error("[api-keys] saveApiKey error:", err);
    return { success: false, verified: false, error: err instanceof Error ? err.message : "Failed to save API key" };
  }
}

// ─── Delete API key ──────────────────────────────────────────────────────────

export async function deleteApiKey(
  provider: string = "ALPACA",
  environment: AlpacaEnvironment = "PAPER",
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await requireOwnerForKeyMutation();
    await prisma.userApiKey.delete({
      where: { userId_provider_environment: { userId, provider, environment } },
    });
    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete API key" };
  }
}

// ─── Re-verify existing key ──────────────────────────────────────────────────

export async function reverifyApiKey(
  provider: string = "ALPACA",
  environment: AlpacaEnvironment = "PAPER",
): Promise<{ success: boolean; verified: boolean; error?: string }> {
  try {
    const userId = await requireOwnerForKeyMutation();
    const creds = await resolveAlpacaCredentials(userId, environment);
    if (!creds) {
      return { success: false, verified: false, error: "No API key found" };
    }

    try {
      await getAccount(creds);
      await prisma.userApiKey.update({
        where: { userId_provider_environment: { userId, provider, environment } },
        data: { verified: true, verifiedAt: new Date() },
      });
      revalidatePath("/settings");
      return { success: true, verified: true };
    } catch {
      await prisma.userApiKey.update({
        where: { userId_provider_environment: { userId, provider, environment } },
        data: { verified: false },
      });
      revalidatePath("/settings");
      return { success: true, verified: false, error: "Alpaca rejected the credentials" };
    }
  } catch (err) {
    return { success: false, verified: false, error: err instanceof Error ? err.message : "Verification failed" };
  }
}

// ─── Resolve credentials for a user ──────────────────────────────────────────
// Used by agent routes and crons to get Alpaca creds.
// Returns null if no user key found (callers fall back to env vars).

// ─── ElevenLabs API key ───────────────────────────────────────────────────────
// Read from ELEVENLABS_API_KEY environment variable.

/** Returns the ElevenLabs API key from the environment. */
export async function resolveElevenLabsKey(_userId?: string): Promise<string | null> {
  return process.env.ELEVENLABS_API_KEY ?? null;
}

/**
 * Fetch ElevenLabs voice list.
 * Returns empty array when the env key is missing or the API call fails.
 */
export async function getElevenLabsVoices(): Promise<{ voices: ElevenLabsVoice[]; error?: string }> {
  const apiKey = await resolveElevenLabsKey();
  if (!apiKey) return { voices: [], error: "ELEVENLABS_API_KEY env var is not set" };
  try {
    const voices = await listVoices(apiKey);
    return { voices };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api-keys] getElevenLabsVoices error:", msg);
    return { voices: [], error: msg };
  }
}

// ─── Resolve credentials for a user ──────────────────────────────────────────
// Used by agent routes and crons to get Alpaca creds.
// Returns null if no user key found (callers fall back to env vars).

export async function resolveAlpacaCredentials(
  userId: string,
  environment: AlpacaEnvironment = "PAPER",
): Promise<AlpacaCredentials | null> {
  // Walk the caller up to the account OWNER. Keys live on the OWNER's
  // UserApiKey row; EDITOR/VIEWER teammates inherit them so their runs
  // trade against the owner's broker account. Crons that pass the
  // analyst's own userId (already the OWNER) are idempotent — they
  // resolve back to themselves.
  const ownerUserId = (await resolveKeyOwnerUserId(userId)) ?? userId;

  const row = await prisma.userApiKey.findUnique({
    where: {
      userId_provider_environment: { userId: ownerUserId, provider: "ALPACA", environment },
    },
    select: { encryptedKey: true, encryptedSecret: true, baseUrl: true },
  });

  if (!row) return null;

  try {
    return {
      keyId: unpackAndDecrypt(row.encryptedKey),
      secretKey: unpackAndDecrypt(row.encryptedSecret),
      baseUrl: row.baseUrl ?? defaultBaseUrl(environment),
    };
  } catch (err) {
    console.error("[api-keys] Failed to decrypt credentials for user", ownerUserId, err);
    return null;
  }
}
