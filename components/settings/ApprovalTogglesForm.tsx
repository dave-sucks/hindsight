"use client";

/**
 * Trade-as-Proposal — Account-level approval toggles.
 *
 * Two switches, OWNER-only. Each switch directly drives Account.require
 * ApprovalFor{Buys,Sells} via a server action. The toggle takes effect on
 * the next agent tool call — see lib/proposals/maybe-await-approval.ts.
 *
 * Pattern mirrors AlpacaKeyForm / ModelPreferenceForm — single Card with
 * a row per toggle, switch on the right, helper text on the left.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  setAccountApprovalToggle,
  type AccountApprovalSettings,
} from "@/lib/actions/account-settings.actions";

interface Props {
  initial: AccountApprovalSettings;
  /** False for non-OWNER members — renders the switches disabled with a hint. */
  canEdit: boolean;
}

export function ApprovalTogglesForm({ initial, canEdit }: Props) {
  const [settings, setSettings] = useState<AccountApprovalSettings>(initial);
  const [pending, startTransition] = useTransition();

  function toggle(
    field: "requireApprovalForBuys" | "requireApprovalForSells",
    value: boolean,
  ) {
    // Optimistic — flip immediately so the switch responds, revert on error.
    const prev = settings;
    setSettings({ ...settings, [field]: value });
    startTransition(async () => {
      try {
        const next = await setAccountApprovalToggle({ field, value });
        setSettings(next);
        toast.success(
          field === "requireApprovalForBuys"
            ? value
              ? "Buys now require approval"
              : "Buys will execute automatically"
            : value
              ? "Sells now require approval"
              : "Sells will execute automatically",
        );
      } catch (err) {
        // Revert optimistic update on failure.
        setSettings(prev);
        toast.error(err instanceof Error ? err.message : "Failed to update setting");
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="space-y-0.5">
            <Label className="text-sm">Require approval for buys</Label>
            <p className="text-xs text-muted-foreground">
              Agent-proposed entries + adds wait for your decision before submitting
              to Alpaca. Manual buy buttons in the UI are unaffected.
            </p>
          </div>
          <Switch
            checked={settings.requireApprovalForBuys}
            disabled={!canEdit || pending}
            onCheckedChange={(v) => toggle("requireApprovalForBuys", v)}
            aria-label="Require approval for buys"
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="space-y-0.5">
            <Label className="text-sm">Require approval for sells</Label>
            <p className="text-xs text-muted-foreground">
              Agent-proposed closes + partial closes wait for your decision.
              Price-monitor trailing stops + manual close buttons are unaffected
              (you already approved the stop at trade-entry time).
            </p>
          </div>
          <Switch
            checked={settings.requireApprovalForSells}
            disabled={!canEdit || pending}
            onCheckedChange={(v) => toggle("requireApprovalForSells", v)}
            aria-label="Require approval for sells"
          />
        </div>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only the account owner can change these settings.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Applies to PAPER and LIVE analysts equally. Approvals show up inline
          in the chat, homepage, /trades, and the thesis sheet.
        </p>
      </CardContent>
    </Card>
  );
}
