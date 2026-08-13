import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import {
  SettingsPageHeader,
  SettingsSection,
} from "@/components/settings/SettingsSection";
import { LevelTriggersSection } from "@/components/settings/LevelTriggersSection";

/**
 * /settings/triggers — the ACCOUNT level of the trigger cascade, and the
 * first place the app defaults are visible at all.
 *
 * Before this page existed, "what protection does every holding carry?"
 * was answerable only by reading `lib/agent/triggers/defaults.ts`. The
 * rungs here are the same pills the thesis sheet renders: your own
 * account-wide rules solid and editable, the app defaults dashed and
 * read-only beneath them.
 */
export default async function TriggerSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/settings/profile");

  const role = await getUserRole(user.id, accountId);
  if (!role) redirect("/settings/profile");

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
      <SettingsPageHeader
        title="Triggers"
        description="Standing rules for every analyst on this account. A rung set here applies to every thesis unless an analyst or a specific thesis overrides it."
      />

      <SettingsSection
        title="Account rules"
        description="Rules you set for every analyst, and the built-in defaults they sit on top of."
      >
        <LevelTriggersSection
          level="account"
          ownerId={accountId}
          editable={role !== "VIEWER"}
        />
      </SettingsSection>

      <SettingsSection
        title="How the levels stack"
        description="Most specific wins. Account rules override the app defaults; an analyst overrides the account; a single thesis overrides them all. Deleting a rung reveals whatever sits beneath it."
      >
        <p className="text-xs text-muted-foreground">
          Rules here can only express things that mean the same on every
          name — a trailing stop, a gain checkpoint, a daily-move rule. An
          absolute price level belongs on the thesis that has that price.
        </p>
      </SettingsSection>
    </div>
  );
}
