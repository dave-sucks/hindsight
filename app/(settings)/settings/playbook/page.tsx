import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getAccountId } from "@/lib/auth/account";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/SettingsSection";
import { PlaybookSetupsForm } from "@/components/settings/PlaybookSetupsForm";
import { getPlaybookSettings } from "@/lib/actions/playbook-settings.actions";

/**
 * /settings/playbook — the setup catalog's numbers, visible and editable
 * (DAV-273). What the writer prices a plan by, what a fill writes onto a
 * stock, what the tactical run confirms by. The catalog is the default;
 * a number changed here changes what the next plan and the next fill use.
 */
export default async function PlaybookSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/settings/profile");

  const settings = await getPlaybookSettings();
  const changed = settings.setups.filter((s) => s.overridden.length > 0).length;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
      <SettingsPageHeader
        title="Playbook"
        description="The setups your analysts trade. Every plan is priced by these numbers, every buy writes its exits from them, and changing one changes the next plan."
      />
      <SettingsSection
        title="Setups"
        description={`${settings.setups.length} setups${changed > 0 ? ` · ${changed} changed` : ""}. Open one to read it and set its numbers.`}
      >
        <PlaybookSetupsForm initial={settings.setups} canEdit={settings.canEdit} />
      </SettingsSection>
    </div>
  );
}
