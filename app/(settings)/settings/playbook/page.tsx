import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getAccountId } from "@/lib/auth/account";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/SettingsSection";
import { PlaybookSetupsForm } from "@/components/settings/PlaybookSetupsForm";
import { getPlaybookSettings } from "@/lib/actions/playbook-settings.actions";

/**
 * /settings/playbook — the setup catalog: each playbook's triggers (what it
 * writes on a stock: on a watch, with the buy, at the fill) and its sell
 * distance numbers (DAV-273). The catalog is the default; a number changed
 * here changes what the next sale is held to.
 */
export default async function PlaybookSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/settings");

  const settings = await getPlaybookSettings();
  const changed = settings.setups.filter((s) => s.overridden.length > 0).length;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
      <SettingsPageHeader
        title="Playbook"
        description="The setups your analysts trade. Each one's triggers are what it writes on a stock, and its numbers bound the sale a buy brings."
      />
      <SettingsSection
        title="Setups"
        description={`${settings.setups.length} setups${changed > 0 ? ` · ${changed} changed` : ""}. Open one to read it, see its triggers and set its numbers.`}
      >
        <PlaybookSetupsForm initial={settings.setups} canEdit={settings.canEdit} />
      </SettingsSection>
    </div>
  );
}
