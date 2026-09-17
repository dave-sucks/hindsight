"use client";

/**
 * PlaybookSetupsForm — one card per setup: the playbook's words read-only,
 * the numbers editable, Save and Reset per setup (DAV-273).
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { savePlaybookSetup, type PlaybookSetupView } from "@/lib/actions/playbook-settings.actions";
import type { SetupOverride } from "@/lib/agent/knowledge/setup-overrides";

interface Props {
  initial: PlaybookSetupView[];
  canEdit: boolean;
}

const NUMBER_FIELDS: Array<{ key: keyof SetupOverride; label: string; suffix: string; help: string; nullable: boolean; step: number }> = [
  { key: "stopMaxPct", label: "Widest stop on a trade", suffix: "%", help: "A TRADE stop can't sit further than this from entry. Blank = no cap.", nullable: true, step: 0.5 },
  { key: "minAtr", label: "Closest stop", suffix: "ATR", help: "A stop closer than this many days' typical range is inside the noise.", nullable: false, step: 0.25 },
  { key: "chaseLimitPct", label: "Chase limit", suffix: "%", help: "Don't buy more than this far past the level. Blank = no chase rule.", nullable: true, step: 0.5 },
  { key: "targetMinR", label: "Target floor", suffix: "R", help: "The reward-to-risk a plan must clear.", nullable: false, step: 0.5 },
  { key: "partialAtR", label: "Partial sale at", suffix: "R", help: "A buy writes a trim at this many R on the stock. Blank = none.", nullable: true, step: 0.5 },
  { key: "timeTradingDays", label: "Time limit", suffix: "days", help: "A buy writes a review this many days after it on the stock. Blank = none.", nullable: true, step: 1 },
  { key: "riskMultiplier", label: "Risk multiplier", suffix: "×", help: "Multiplies the risk per trade (0.5 for a binary event).", nullable: false, step: 0.25 },
];

function SetupCard({ setup, canEdit, onSaved }: { setup: PlaybookSetupView; canEdit: boolean; onSaved: (v: PlaybookSetupView) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, setup.numbers[f.key] == null ? "" : String(setup.numbers[f.key])])),
  );
  const [beatAndFade, setBeatAndFade] = useState<boolean>(setup.numbers.beatAndFadeReview);
  const [pending, start] = useTransition();

  const dirty =
    beatAndFade !== setup.numbers.beatAndFadeReview ||
    NUMBER_FIELDS.some((f) => (values[f.key] === "" ? null : Number(values[f.key])) !== setup.numbers[f.key]);

  function submit(numbers: SetupOverride) {
    start(async () => {
      try {
        const saved = await savePlaybookSetup({ setupId: setup.id, numbers });
        onSaved(saved);
        setValues(Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, saved.numbers[f.key] == null ? "" : String(saved.numbers[f.key])])));
        setBeatAndFade(saved.numbers.beatAndFadeReview);
        toast.success(`${setup.name}: saved`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function save() {
    const numbers: SetupOverride = { beatAndFadeReview: beatAndFade };
    for (const f of NUMBER_FIELDS) {
      const raw = values[f.key];
      if (raw === "") {
        if (f.nullable) (numbers as Record<string, unknown>)[f.key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        toast.error(`${f.label}: not a number`);
        return;
      }
      (numbers as Record<string, unknown>)[f.key] = n;
    }
    submit(numbers);
  }

  function reset() {
    submit(setup.defaults);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {setup.name} <span className="text-xs text-muted-foreground">{setup.code} · {setup.horizons.join(", ")}</span>
          </p>
          <p className="text-sm text-muted-foreground">{setup.summary}</p>
        </div>
        {setup.overridden.length ? <span className="text-xs text-muted-foreground">{setup.overridden.length} changed</span> : null}
      </div>
      <dl className="grid grid-cols-[6em_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entry</dt>
        <dd className="text-muted-foreground">{setup.entryText}</dd>
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stop</dt>
        <dd className="text-muted-foreground">{setup.stopText}</dd>
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target</dt>
        <dd className="text-muted-foreground">{setup.targetText}</dd>
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Time</dt>
        <dd className="text-muted-foreground">{setup.timeText}</dd>
      </dl>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NUMBER_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`${setup.id}-${f.key}`}>
              {f.label} <span className="text-xs text-muted-foreground">({f.suffix})</span>
            </Label>
            <Input
              id={`${setup.id}-${f.key}`}
              type="number"
              inputMode="decimal"
              step={f.step}
              value={values[f.key]}
              placeholder={f.nullable ? "none" : ""}
              disabled={!canEdit || pending}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">{f.help}</p>
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor={`${setup.id}-beat`}>Beat-that-sold review</Label>
          <div className="flex items-center gap-2">
            <Switch id={`${setup.id}-beat`} checked={beatAndFade} disabled={!canEdit || pending} onCheckedChange={(c) => setBeatAndFade(!!c)} />
            <span className="text-xs text-muted-foreground">A buy writes a review for a beat the stock fell 3%+ on.</span>
          </div>
        </div>
      </div>
      {canEdit ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={pending || setup.overridden.length === 0}>
            Reset to the playbook
          </Button>
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PlaybookSetupsForm({ initial, canEdit }: Props) {
  const [setups, setSetups] = useState(initial);
  return (
    <>
      {setups.map((s) => (
        <SetupCard
          key={s.id}
          setup={s}
          canEdit={canEdit}
          onSaved={(v) => setSetups((list) => list.map((x) => (x.id === v.id ? v : x)))}
        />
      ))}
    </>
  );
}
