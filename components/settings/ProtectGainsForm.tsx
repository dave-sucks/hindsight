"use client";

/**
 * Protect gains — the owner's account setting (lib/agent/triggers/protect-gains.ts):
 * it raises each holding's floor. One switch, the two numbers, and how the high is counted. Saving with the
 * high counted from each buy first lists every holding that would sell right
 * away at today's price, with what it would realize. Rows render straight into
 * the parent SettingsSection, which draws the dividers.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { InfoRow } from "@/components/ui/info-row";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  previewProtectGains,
  setProtectGains,
  type ImmediateSale,
  type ProtectGainsSettings,
} from "@/lib/actions/protect-gains.actions";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;

export function ProtectGainsForm({ initial, canEdit }: { initial: ProtectGainsSettings; canEdit: boolean }) {
  const [on, setOn] = useState(initial.on);
  const [startPct, setStartPct] = useState(String(initial.startPct));
  const [giveBackPct, setGiveBackPct] = useState(String(initial.giveBackPct));
  const [from, setFrom] = useState<"NOW" | "BUY">(initial.from);
  const [sales, setSales] = useState<ImmediateSale[] | null>(null);
  const [pending, startTransition] = useTransition();
  const numbers = { startPct: Number(startPct), giveBackPct: Number(giveBackPct) };

  function commit() {
    startTransition(async () => {
      try {
        const saved = await setProtectGains({ on, from, ...numbers });
        setSales(null);
        toast.success(saved.on ? "Protect gains is on" : "Protect gains is off");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save Protect gains");
      }
    });
  }

  function save() {
    // Counted from each buy, a stock already past its line sells at once: show those first.
    if (!(on && from === "BUY")) return commit();
    startTransition(async () => {
      try {
        setSales(await previewProtectGains(numbers));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to check the holdings");
      }
    });
  }

  const total = (sales ?? []).reduce((sum, s) => sum + s.result, 0);
  const off = !canEdit || pending;

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
      <div className="space-y-2">
        <RadioGroup value={from} onValueChange={(v) => setFrom(v === "BUY" ? "BUY" : "NOW")} disabled={off}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="NOW" id="protect-from-now" />
            <Label htmlFor="protect-from-now">Count the high from now</Label>
          </div>
          <p className="text-xs text-muted-foreground">Nothing sells when you save. Each holding&apos;s high starts at today&apos;s price.</p>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="BUY" id="protect-from-buy" />
            <Label htmlFor="protect-from-buy">Count the high from each stock&apos;s buy</Label>
          </div>
          <p className="text-xs text-muted-foreground">Uses the high since we bought it, so a holding that has already given back more than the second number sells right away.</p>
        </RadioGroup>
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">A holding that opens below its floor sells at the opening price, which can be below what we paid.</p>
        <Button onClick={save} disabled={off}>Save</Button>
      </div>

      <AlertDialog open={sales != null} onOpenChange={(open) => !open && setSales(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sales?.length ? `${sales.length} holding${sales.length === 1 ? "" : "s"} would sell right away` : "Nothing would sell right away"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Counted from each buy, at today&apos;s prices. They go up for sale at the next check, within five minutes while the market is open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {sales?.length ? (
            <div className="space-y-1 text-sm">
              {sales.map((s) => (
                <div key={s.ticker} className="flex items-center justify-between gap-3 tabular-nums">
                  <span>
                    {s.ticker} · {s.shares} at {money(s.price)}, under a {money(s.line)} floor
                  </span>
                  <span className={s.result >= 0 ? "text-emerald-500" : "text-red-500"}>{signed(s.result)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t pt-1 font-medium tabular-nums">
                <span>Total</span>
                <span className={total >= 0 ? "text-emerald-500" : "text-red-500"}>{signed(total)}</span>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={commit} disabled={pending}>
              Turn it on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
