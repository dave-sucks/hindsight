"use server";

// The key and voice actions a browser may call. Their code is in api-keys.actions.ts, which is
// server-only because it also reads decrypted broker keys: that must never be a browser-callable action.
import * as keys from "@/lib/actions/api-keys.actions";
import { createClient } from "@/lib/supabase/server";

/** Owner only (checked in the save itself). */
export async function saveApiKey(input: keys.SaveApiKeyInput) {
  return keys.saveApiKey(input);
}

export async function deleteApiKey(provider?: string, environment?: keys.AlpacaEnvironment) {
  return keys.deleteApiKey(provider, environment);
}

export async function reverifyApiKey(provider?: string, environment?: keys.AlpacaEnvironment) {
  return keys.reverifyApiKey(provider, environment);
}

/** The voice list is read with the server's key, so only for someone signed in. */
export async function getElevenLabsVoices() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { voices: [], error: "Not signed in" };
  return keys.getElevenLabsVoices();
}
