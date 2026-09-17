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

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
      <SettingsPageHeader
        title="Playbook"
        description="The setups your analysts trade, with their numbers. The writer prices a plan by these, a buy writes the stock's own exits from them, and the tactical run confirms by them. Change a number and the next plan uses it."
      />
      <SettingsSection
        title="Setups"
        description="The words are the playbook's. The numbers are yours to set; Reset puts the playbook's back."
      >
        <PlaybookSetupsForm initial={settings.setups} canEdit={settings.canEdit} />
      </SettingsSection>
    </div>
  );
}
