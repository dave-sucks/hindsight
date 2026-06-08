"use client";

/**
 * Trade-as-Proposal — Account-level approval toggles, split per environment.
 *
 * Four switches in two groups: LIVE (real money — review required for
 * disclosure) and PAPER (fake money — auto-executes; flip on only to test
 * the approval flow). Each group has a buys + sells switch. OWNER-only.
 *
 * The gate (lib/proposals/maybe-await-approval.ts) reads the column matching
 * the trade's Position.environment, so PAPER and LIVE behave independently —
 * exactly "auto-execute paper, review live."
 *
 * Renders as a flat stack of InfoRows — the parent SettingsSection supplies
 * the outer Card.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { useState, useTransition } from "react";
import { InfoRow } from "@/components/ui/info-row";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  setAccountApprovalToggle,
  type AccountApprovalSettings,
  type ApprovalToggleField,
} from "@/lib/actions/account-settings.actions";

interface Props {
  initial: AccountApprovalSettings;
  /** False for non-OWNER members — switches render disabled. */
  canEdit: boolean;
}

const HUMAN: Record<ApprovalToggleField, { on: string; off: string }> = {
  requireApprovalBuysLive: {
    on: "Live buys now require approval",
    off: "Live buys will execute automatically",
  },
  requireApprovalSellsLive: {
    on: "Live sells now require approval",
    off: "Live sells will execute automatically",
  },
  requireApprovalBuysPaper: {
    on: "Paper buys now require approval",
    off: "Paper buys will execute automatically",
  },
  requireApprovalSellsPaper: {
    on: "Paper sells now require approval",
    off: "Paper sells will execute automatically",
  },
};

const ROWS: Array<{
  field: ApprovalToggleField;
  label: string;
  description: string;
}> = [
  {
    field: "requireApprovalBuysLive",
    label: "Live buys",
    description: "Agent-proposed entries on real-money positions wait for your decision.",
  },
  {
    field: "requireApprovalSellsLive",
    label: "Live sells",
    description: "Agent-proposed closes + partial closes on real-money positions wait for your decision.",
  },
  {
    field: "requireApprovalBuysPaper",
    label: "Paper buys",
    description: "Agent-proposed entries on paper positions wait for your decision. Off = auto-execute.",
  },
  {
    field: "requireApprovalSellsPaper",
    label: "Paper sells",
    description: "Agent-proposed closes on paper positions wait for your decision. Off = auto-execute.",
  },
];

export function ApprovalTogglesForm({ initial, canEdit }: Props) {
  const [settings, setSettings] = useState<AccountApprovalSettings>(initial);
  const [pending, startTransition] = useTransition();

  function toggle(field: ApprovalToggleField, value: boolean) {
    const prev = settings;
    setSettings({ ...settings, [field]: value });
    startTransition(async () => {
      try {
        const next = await setAccountApprovalToggle({ field, value });
        setSettings(next);
        toast.success(value ? HUMAN[field].on : HUMAN[field].off);
      } catch (err) {
        setSettings(prev);
        toast.error(err instanceof Error ? err.message : "Failed to update setting");
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
            checked={settings[row.field]}
            disabled={!canEdit || pending}
            onCheckedChange={(v) => toggle(row.field, v)}
            aria-label={row.label}
          />
        </InfoRow>
      ))}
    </>
  );
}
