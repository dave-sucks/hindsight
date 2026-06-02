"use client";

/**
 * Trade-as-Proposal — Account-level approval toggles, split per environment.
 *
 * Four switches in two groups: LIVE (real money — review required for
 * disclosure) and PAPER (fake money — auto-executes; flip on only to test
 * the approval flow). Each group has a buys + sells switch. OWNER-only.
 *
 * The gate (lib/proposals/maybe-await-approval.ts) reads the column
 * matching the trade's Position.environment, so PAPER and LIVE behave
 * independently — exactly "auto-execute paper, review live."
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  setAccountApprovalToggle,
  type AccountApprovalSettings,
  type ApprovalToggleField,
} from "@/lib/actions/account-settings.actions";

interface Props {
  initial: AccountApprovalSettings;
  /** False for non-OWNER members — renders the switches disabled with a hint. */
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

export function ApprovalTogglesForm({ initial, canEdit }: Props) {
  const [settings, setSettings] = useState<AccountApprovalSettings>(initial);
  const [pending, startTransition] = useTransition();

  function toggle(field: ApprovalToggleField, value: boolean) {
    const prev = settings;
    // Optimistic — flip immediately so the switch responds, revert on error.
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
    <Card>
      <CardContent className="p-4 space-y-5">
        {/* ── Live ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Live</Badge>
            <p className="text-xs text-muted-foreground">
              Real money. Review required for disclosure.
            </p>
          </div>
          <ToggleRow
            label="Require approval for buys"
            help="Agent-proposed entries + adds wait for your decision."
            checked={settings.requireApprovalBuysLive}
            disabled={!canEdit || pending}
            onChange={(v) => toggle("requireApprovalBuysLive", v)}
          />
          <Separator />
          <ToggleRow
            label="Require approval for sells"
            help="Agent-proposed closes + partial closes wait for your decision."
            checked={settings.requireApprovalSellsLive}
            disabled={!canEdit || pending}
            onChange={(v) => toggle("requireApprovalSellsLive", v)}
          />
        </div>

        <Separator />

        {/* ── Paper ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Paper</Badge>
            <p className="text-xs text-muted-foreground">
              Fake money. Auto-executes; turn on only to test the approval flow.
            </p>
          </div>
          <ToggleRow
            label="Require approval for buys"
            help="Agent-proposed entries + adds wait for your decision."
            checked={settings.requireApprovalBuysPaper}
            disabled={!canEdit || pending}
            onChange={(v) => toggle("requireApprovalBuysPaper", v)}
          />
          <Separator />
          <ToggleRow
            label="Require approval for sells"
            help="Agent-proposed closes + partial closes wait for your decision."
            checked={settings.requireApprovalSellsPaper}
            disabled={!canEdit || pending}
            onChange={(v) => toggle("requireApprovalSellsPaper", v)}
          />
        </div>

        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only the account owner can change these settings.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Manual buy/sell buttons + price-monitor trailing stops always
          execute — these gates only apply to agent-initiated trades.
          Approvals show up inline in the chat, homepage, /trades, and the
          thesis sheet.
        </p>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="space-y-0.5">
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}
