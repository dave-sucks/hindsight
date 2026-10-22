"use client";

/**
 * Stop when buying — one row: the switch, the label, the percent. On the
 * account's Triggers page and on each analyst's Triggers tab. An analyst
 * shows the account's values until it is given its own.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { getAutoStop, saveAutoStop, type AutoStopView } from "@/lib/actions/auto-stop.actions";

export function AutoStopSetting({ level, ownerId }: { level: "account" | "analyst"; ownerId: string }) {
  const [view, setView] = useState<AutoStopView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  const own = view?.analyst != null && (view.analyst.on != null || view.analyst.pct != null);
  const on = view?.analyst?.on ?? view?.account.on ?? false;
  const pct = view?.analyst?.pct ?? view?.account.pct ?? 8;

  useEffect(() => {
    getAutoStop(level, ownerId)
      .then((v) => {
        setView(v);
        setText(String(v.analyst?.pct ?? v.account.pct));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [level, ownerId]);

  function save(next: { on: boolean; pct: number } | { reset: true }) {
    startTransition(async () => {
      const r = await saveAutoStop({ level, ownerId, ...next });
      if (!r.ok) {
        toast.error(r.error);
        setText(String(pct));
        return;
      }
      setView(r.view);
      setText(String(r.view.analyst?.pct ?? r.view.account.pct));
    });
  }

  function commitPct() {
    const n = Number(text.trim());
    if (text.trim() === "" || n === pct) return setText(String(pct));
    save({ on, pct: n });
  }

  if (error) return <p className="text-xs text-muted-foreground">Couldn&apos;t load the stop setting: {error}</p>;
  if (!view) return <p className="text-xs text-muted-foreground">Loading…</p>;

  const id = `auto-stop-${level}-${ownerId}`;
  const locked = !view.canEdit || pending;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <Switch id={id} checked={on} disabled={locked} onCheckedChange={(v) => save({ on: v, pct })} />
        <Label htmlFor={id}>Automatically set Stop Limits when Buying a Stock</Label>
        <div className="ml-auto w-20 shrink-0">
          <InputGroup>
            <InputGroupInput
              type="text"
              inputMode="decimal"
              size={4}
              value={text}
              aria-label="Stop, percent under the buy price"
              disabled={!on || locked}
              onChange={(e) => setText(e.target.value)}
              onBlur={commitPct}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPct();
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>%</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>
      {level === "analyst" ? (
        own ? (
          <Button variant="link" size="xs" disabled={locked} onClick={() => save({ reset: true })}>
            Use account setting
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">The account&apos;s setting.</p>
        )
      ) : null}
    </div>
  );
}
