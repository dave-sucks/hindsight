/**
 * Supabase service-role client for server-side operations that run
 * without a user session (e.g. Inngest background jobs).
 *
 * IMPORTANT: Never expose this client to the browser. The service role key
 * bypasses Row Level Security — only use it from trusted server contexts.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY environment variable.
 *
 * Tagged SHARED in docs/PODCAST_FILES.md (Session 2 — added for podcast
 * audio Storage uploads from Inngest).
 */

import { createClient } from "@supabase/supabase-js";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
