import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import {
  SettingsPageHeader,
  SettingsSection,
} from "@/components/settings/SettingsSection";
import { LevelTriggersSection } from "@/components/settings/LevelTriggersSection";
import { AutoStopSetting } from "@/components/settings/AutoStopSetting";

/**
 * /settings/triggers — the ACCOUNT level of the trigger cascade, the
 * bottom of it. The built-in rules are seeded here as ordinary editable
 * rules; the pills are the same ones the thesis sheet renders.
 */
export default async function TriggerSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/settings");

  const role = await getUserRole(user.id, accountId);
  if (!role) redirect("/settings");

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
      <SettingsPageHeader
        title="Triggers"
        description="Standing rules for every analyst on this account. A rule set here applies to every stock, unless the analyst or the stock has its own trigger for the same thing."
      />

      <SettingsSection
        title="Stop when buying"
        description="A new holding gets a floor this far under its buy price, unless it already has a higher one. An analyst can set its own."
      >
        <AutoStopSetting level="account" ownerId={accountId} />
      </SettingsSection>

      <SettingsSection
        title="Account rules"
        description="Rules for every analyst on this account."
      >
        <LevelTriggersSection level="account" ownerId={accountId} />
      </SettingsSection>

      <SettingsSection
        title="Which rule wins"
        description="The most specific one. An analyst's rule beats the account's, and a stock's own trigger beats both. Delete one and the next one down applies."
      >
        <p className="text-xs text-muted-foreground">
          Rules here can only say things that mean the same on every stock: a
          sale on a fall from the peak, a review at a gain, a rule on the
          day&rsquo;s move. A trigger at a set price belongs on the stock
          it&rsquo;s for.
        </p>
      </SettingsSection>

      <SettingsSection
        title="When triggers are checked"
        description="Every 5 minutes from 9:30 to the close on trading days (1 PM on half days). Never before the open, after hours, on weekends or on holidays."
      >
        <p className="text-xs text-muted-foreground">
          A trigger that reads &ldquo;only on the close&rdquo; is checked once,
          at 4:20 PM, on the day&rsquo;s closing price. No order waits at
          Alpaca: a floor broken overnight is acted on at the first check after
          the open. A buy or an add waits for a price from the last 15 minutes;
          a sale or a review doesn&rsquo;t, because missing a sale is worse.
        </p>
      </SettingsSection>
    </div>
  );
}
