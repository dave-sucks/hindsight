"use client";

/**
 * Personal email notification preferences — the three per-member booleans
 * on AccountMembership (trade proposals / trade activity / daily digest).
 *
 * Self-service only: this form always edits the signed-in member's OWN
 * membership row via PATCH /api/settings/team/members/[userId]; the route
 * rejects cross-member edits. Notification prefs are personal — there is
 * deliberately no admin view of other members' toggles.
 *
 * Renders as a flat stack of InfoRows — the parent SettingsSection supplies
 * the heading, same pattern as ApprovalTogglesForm.
 */

import { useState, useTransition } from "react";
import { InfoRow } from "@/components/ui/info-row";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export interface EmailNotificationPrefs {
  emailTradeProposals: boolean;
  emailTradeActivity: boolean;
  emailDailyDigest: boolean;
}

type PrefField = keyof EmailNotificationPrefs;

const ROWS: Array<{
  field: PrefField;
  label: string;
  description: string;
}> = [
  {
    field: "emailTradeProposals",
    label: "Trade proposals",
    description:
      "Approval requests when an agent wants to buy or sell and the account requires sign-off.",
  },
  {
    field: "emailTradeActivity",
    label: "Trade activity",
    description:
      "Alerts when a position is opened or closed outside the morning run.",
  },
  {
    field: "emailDailyDigest",
    label: "Daily digest",
    description:
      "The morning run summary — thesis updates, trades, and watchlist changes.",
  },
];

export function EmailNotificationsForm({
  userId,
  initial,
}: {
  userId: string;
  initial: EmailNotificationPrefs;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle(field: PrefField, value: boolean) {
    const prev = prefs;
    setPrefs({ ...prefs, [field]: value });
    startTransition(async () => {
      const res = await fetch(`/api/settings/team/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to update notifications.");
        setPrefs(prev);
      }
    });
  }

  return (
    <>
      {ROWS.map((row) => (
        <InfoRow
          key={row.field}
          label={row.label}
          description={row.description}
          border={false}
        >
          <Switch
            checked={prefs[row.field]}
            disabled={pending}
            onCheckedChange={(v) => toggle(row.field, v)}
            aria-label={row.label}
          />
        </InfoRow>
      ))}
    </>
  );
}
