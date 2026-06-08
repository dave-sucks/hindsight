import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAccountId, getOwnerUserId, getUserRole } from "@/lib/auth/account";
import { getAlpacaKeyStatuses } from "@/lib/actions/api-keys.actions";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { AlpacaConnectionCard } from "@/components/settings/AlpacaConnectionCard";
import { ConnectionCard } from "@/components/settings/ConnectionCard";

export default async function ConnectionsSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/settings/profile");

  const role = await getUserRole(user.id, accountId);
  const isOwner = role === "OWNER";

  const [alpacaStatuses, ownerEmail] = await Promise.all([
    getAlpacaKeyStatuses(),
    !isOwner
      ? getOwnerUserId(accountId).then((ownerId) =>
          ownerId
            ? prisma.user
                .findUnique({ where: { id: ownerId }, select: { email: true } })
                .then((u) => u?.email ?? null)
            : null,
        )
      : Promise.resolve(null),
  ]);
  const elevenLabsConfigured = !!process.env.ELEVENLABS_API_KEY;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-8">
      <SettingsPageHeader
        title="Connections"
        description="Connect external accounts so Hindsight can place trades, fetch data, and generate audio."
      />

      <div className="space-y-3">
        <AlpacaConnectionCard
          paper={alpacaStatuses.paper}
          live={alpacaStatuses.live}
          canEdit={isOwner}
          ownerEmail={ownerEmail}
        />
        <ConnectionCard
          logo={
            <div className="size-8 rounded-md bg-muted flex items-center justify-center text-xs font-bold tabular-nums">
              11
            </div>
          }
          title="ElevenLabs"
          description="Text-to-speech for podcast generation."
          status={elevenLabsConfigured ? "configured" : "not-connected"}
        />
      </div>
    </div>
  );
}
