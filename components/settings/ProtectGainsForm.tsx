"use client";

/**
 * Protect gains — the owner's account setting (lib/agent/triggers/protect-gains.ts):
 * it raises each holding's floor. One switch and the two numbers. Rows render
 * straight into the parent SettingsSection, which draws the dividers.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { InfoRow } from "@/components/ui/info-row";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setProtectGains, type ProtectGainsSettings } from "@/lib/actions/protect-gains.actions";

export function ProtectGainsForm({ initial, canEdit }: { initial: ProtectGainsSettings; canEdit: boolean }) {
  const [on, setOn] = useState(initial.on);
  const [startPct, setStartPct] = useState(String(initial.startPct));
  const [giveBackPct, setGiveBackPct] = useState(String(initial.giveBackPct));
  const [pending, startTransition] = useTransition();
  const off = !canEdit || pending;

  function save() {
    startTransition(async () => {
      try {
        const saved = await setProtectGains({ on, startPct: Number(startPct), giveBackPct: Number(giveBackPct) });
        toast.success(saved.on ? "Protect gains is on" : "Protect gains is off");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save Protect gains");
      }
    });
  }

  return (
    <>
      <InfoRow
        label="Protect gains"
        border={false}
        description="Once a holding is up, its floor rises with it, so it never goes back below its buy price. It covers every holding on the account, and no analyst can lower the floor."
      >
        <Switch checked={on} disabled={off} onCheckedChange={setOn} aria-label="Protect gains" />
      </InfoRow>
      <InfoRow label="Start once up (%)" border={false} description="How far over the buy price a holding's high must get before it is protected.">
        <div className="w-24">
          <Input type="number" inputMode="decimal" min={0.5} max={50} step={0.5} value={startPct} disabled={off} onChange={(e) => setStartPct(e.target.value)} aria-label="Start once up, percent" />
        </div>
      </InfoRow>
      <InfoRow label="Then give back at most (%)" border={false} description="How far under that high the floor sits. It never sits below the buy price, and it never comes down.">
        <div className="w-24">
          <Input type="number" inputMode="decimal" min={1} max={49} step={0.5} value={giveBackPct} disabled={off} onChange={(e) => setGiveBackPct(e.target.value)} aria-label="Give back at most, percent" />
        </div>
      </InfoRow>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">Counts from when you turn it on; nothing sells when you save.</p>
        <Button onClick={save} disabled={off}>Save</Button>
      </div>
    </>
  );
}
