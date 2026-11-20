import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";

type Editor = { userId: string; accountId: string; error?: undefined };

/**
 * The signed-in member acting on their own account, or why not. Only an
 * owner or an editor moves money or an analyst; a view-only member reads.
 */
export async function editorOrWhy(): Promise<Editor | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const accountId = await getAccountId(user.id);
  if (!accountId) return { error: "No account" };
  const role = await getUserRole(user.id, accountId);
  if (role !== "OWNER" && role !== "EDITOR") return { error: "View-only members can't do this." };
  return { userId: user.id, accountId };
}

/** The same, thrown: for an action that reports a failure by throwing. */
export async function requireEditor(): Promise<Editor> {
  const who = await editorOrWhy();
  if (who.error !== undefined) throw new Error(who.error);
  return who;
}
