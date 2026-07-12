import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { InfoRow } from "@/components/ui/info-row";
import {
  SettingsPageHeader,
  SettingsSection,
} from "@/components/settings/SettingsSection";
import { ModelPreferenceForm } from "@/components/settings/ModelPreferenceForm";
import { ApprovalTogglesForm } from "@/components/settings/ApprovalTogglesForm";
import { EmailNotificationsForm } from "@/components/settings/EmailNotificationsForm";
import { getAccountApprovalSettings } from "@/lib/actions/account-settings.actions";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/sign-in");

  const [role, approvalSettings, membership] = await Promise.all([
    getUserRole(user.id, accountId),
    getAccountApprovalSettings(),
    prisma.accountMembership.findUnique({
      where: { accountId_userId: { accountId, userId: user.id } },
      select: {
        emailTradeProposals: true,
        emailTradeActivity: true,
        emailDailyDigest: true,
      },
    }),
  ]);
  const isOwner = role === "OWNER";
  const displayName = user.user_metadata?.full_name ?? user.email ?? "—";

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-8">
      <SettingsPageHeader
        title="Profile"
        description="Your account and trading preferences."
      />

      <SettingsSection title="Account">
        <InfoRow label="Name" value={displayName} border={false} />
        <InfoRow label="Email" value={user.email ?? "—"} border={false} />
      </SettingsSection>

      <SettingsSection title="Agent">
        <ModelPreferenceForm border={false} />
      </SettingsSection>

      <SettingsSection
        title="Trade approvals"
        description={
          isOwner
            ? "Choose which agent-initiated trades require your explicit approval before they execute. Manual buy/sell buttons and price-monitor trailing stops always execute."
            : "Only the account owner can change these settings."
        }
      >
        <ApprovalTogglesForm initial={approvalSettings} canEdit={isOwner} />
      </SettingsSection>

      {membership && (
        <SettingsSection
          title="Email notifications"
          description="Which account emails land in your inbox. These are personal — every member manages their own."
        >
          <EmailNotificationsForm userId={user.id} initial={membership} />
        </SettingsSection>
      )}
    </div>
  );
}
