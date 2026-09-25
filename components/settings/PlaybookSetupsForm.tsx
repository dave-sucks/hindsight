"use client";

/**
 * The playbook, as a list of setups.
 *
 * One row per setup — code, name, the horizons it trades, and its numbers in
 * a sentence — and a sheet behind each row for the detail and the editing.
 * Same shape as every other list in the app: the row carries what you scan
 * for, the sheet carries everything else (see the thesis sheet and the
 * analyst configuration sheet). The row never edits.
 *
 * The words in the sheet are the playbook's and read-only. The numbers are
 * the account's: each one sits on its own label-left / value-right row
 * (`InfoRow`, the same rows the thesis sheet uses), shows the playbook's
 * value underneath when this account has changed it, and Save / Reset sit
 * at the bottom of the sheet.
 */

import { useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/info-row";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { GHOST_INPUT } from "@/components/analysts/AnalystConfigForm";
import { cn } from "@/lib/utils";
import {
  savePlaybookSetup,
  type PlaybookSetupView,
} from "@/lib/actions/playbook-settings.actions";
import type { SetupOverride } from "@/lib/agent/knowledge/setup-overrides";

interface NumberField {
  key: keyof SetupOverride;
  label: string;
  /** Unit shown beside the input. */
  suffix: string;
  help: string;
  nullable: boolean;
  step: number;
}

const NUMBER_FIELDS: NumberField[] = [
  {
    key: "stopMaxPct",
    label: "Widest stop",
    suffix: "%",
    help: "A TRADE stop can't sit further than this from entry. Blank = no cap.",
    nullable: true,
    step: 0.5,
  },
  {
    key: "minAtr",
    label: "Closest stop",
    suffix: "ATR",
    help: "A stop closer than this many days' typical range is inside the noise.",
    nullable: false,
    step: 0.25,
  },
  {
    key: "chaseLimitPct",
    label: "Chase limit",
    suffix: "%",
    help: "Don't buy more than this far past the level. Blank = no chase rule.",
    nullable: true,
    step: 0.5,
  },
  {
    key: "targetMinR",
    label: "Target floor",
    suffix: "R",
    help: "The reward-to-risk a plan must clear.",
    nullable: false,
    step: 0.5,
  },
  {
    key: "partialAtR",
    label: "Partial sale at",
    suffix: "R",
    help: "A buy writes a trim at this many R on the stock. Blank = none.",
    nullable: true,
    step: 0.5,
  },
  {
    key: "timeTradingDays",
    label: "Time limit",
    suffix: "",
    help: "A buy writes a review this long after it on the stock. Blank = none.",
    nullable: true,
    step: 1,
  },
  {
    key: "riskMultiplier",
    label: "Risk multiplier",
    suffix: "×",
    help: "Multiplies the risk per trade (0.5 for a binary event).",
    nullable: false,
    step: 0.25,
  },
];

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function unitFor(field: NumberField, setup: PlaybookSetupView): string {
  if (field.key !== "timeTradingDays") return field.suffix;
  return setup.timeUnit === "SESSIONS" ? "sessions" : "days";
}

/** "Stop ≤ 8% · ≥ 2R · trim 2R · 20 sessions" — the row's one-line shape. */
function numbersSentence(setup: PlaybookSetupView): string {
  const n = setup.numbers;
  const parts: string[] = [];
  if (n.stopMaxPct != null) parts.push(`stop ≤ ${n.stopMaxPct}%`);
  parts.push(`target ≥ ${n.targetMinR}R`);
  if (n.partialAtR != null) parts.push(`trim at ${n.partialAtR}R`);
  if (n.timeTradingDays != null) {
    parts.push(
      `${n.timeTradingDays} ${setup.timeUnit === "SESSIONS" ? "sessions" : "days"}`,
    );
  }
  if (n.riskMultiplier !== 1) parts.push(`${n.riskMultiplier}× risk`);
  return parts.join(" · ");
}

// ── Row ──────────────────────────────────────────────────────────────────────
// Code + name on top, horizons + numbers underneath, "Changed" when this
// account has moved something. The whole row opens the sheet.

function SetupRow({
  setup,
  onOpen,
}: {
  setup: PlaybookSetupView;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-accent/40"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">{setup.code}</span>
          <span className="truncate text-sm font-medium">{setup.name}</span>
          {setup.overridden.length > 0 ? (
            <Badge variant="secondary">Changed</Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground tabular-nums">
          {setup.horizons.map(titleCase).join(" · ")} — {numbersSentence(setup)}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ── Sheet ────────────────────────────────────────────────────────────────────

/** A labelled block of the playbook's own prose. */
function PlaybookBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="select-none text-muted-foreground/50">•</span>
          <span className="flex-1">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function SetupSheet({
  setup,
  canEdit,
  open,
  onOpenChange,
  onSaved,
}: {
  setup: PlaybookSetupView;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (v: PlaybookSetupView) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      NUMBER_FIELDS.map((f) => [
        f.key,
        setup.numbers[f.key] == null ? "" : String(setup.numbers[f.key]),
      ]),
    ),
  );
  const [beatAndFade, setBeatAndFade] = useState<boolean>(setup.numbers.beatAndFadeReview);
  const [pending, start] = useTransition();

  const dirty =
    beatAndFade !== setup.numbers.beatAndFadeReview ||
    NUMBER_FIELDS.some(
      (f) => (values[f.key] === "" ? null : Number(values[f.key])) !== setup.numbers[f.key],
    );

  function submit(numbers: SetupOverride) {
    start(async () => {
      try {
        const saved = await savePlaybookSetup({ setupId: setup.id, numbers });
        onSaved(saved);
        setValues(
          Object.fromEntries(
            NUMBER_FIELDS.map((f) => [
              f.key,
              saved.numbers[f.key] == null ? "" : String(saved.numbers[f.key]),
            ]),
          ),
        );
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="lg" floating>
        <SheetHeader>
          <SheetTitle>{setup.name}</SheetTitle>
          <SheetDescription>{setup.summary}</SheetDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge variant="outline">{setup.code}</Badge>
            {setup.horizons.map((h) => (
              <Badge key={h} variant="secondary">
                {titleCase(h)}
              </Badge>
            ))}
          </div>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          {/* ── The playbook's words — read-only ───────────────────────── */}
          <div className="space-y-4">
            <PlaybookBlock label="Entry">{setup.entryText}</PlaybookBlock>
            <PlaybookBlock label="Stop">{setup.stopText}</PlaybookBlock>
            <PlaybookBlock label="Target">{setup.targetText}</PlaybookBlock>
            <PlaybookBlock label="Time">{setup.timeText}</PlaybookBlock>
            {setup.preconditions.length > 0 ? (
              <PlaybookBlock label="Only when">
                <Bullets items={setup.preconditions} />
              </PlaybookBlock>
            ) : null}
            {setup.trail.length > 0 ? (
              <PlaybookBlock label="Trailing a winner">
                <Bullets items={setup.trail.map((t) => `${titleCase(t.horizon)} — ${t.text}`)} />
              </PlaybookBlock>
            ) : null}
            {setup.failureSigns.length > 0 ? (
              <PlaybookBlock label="It failed when">
                <Bullets items={setup.failureSigns} />
              </PlaybookBlock>
            ) : null}
          </div>

          {/* ── The numbers — this account's ──────────────────────────── */}
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Numbers
            </p>
            <div>
              {NUMBER_FIELDS.map((f) => {
                const changed = setup.numbers[f.key] !== setup.defaults[f.key];
                const fallback = setup.defaults[f.key];
                return (
                  <InfoRow
                    key={f.key}
                    label={f.label}
                    tooltip={f.help}
                    description={
                      changed
                        ? `The playbook's: ${fallback == null ? "none" : fallback}${unitFor(f, setup) ? ` ${unitFor(f, setup)}` : ""}`
                        : undefined
                    }
                  >
                    <div className="flex items-center justify-end gap-2">
                      {/* Same ghost number input the analyst settings sheet uses. */}
                      <Input
                        type="number"
                        inputMode="decimal"
                        step={f.step}
                        value={values[f.key]}
                        placeholder={f.nullable ? "none" : ""}
                        disabled={!canEdit || pending}
                        className={cn(GHOST_INPUT, "w-24 text-right tabular-nums")}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [f.key]: e.target.value }))
                        }
                        aria-label={f.label}
                      />
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">
                        {unitFor(f, setup)}
                      </span>
                    </div>
                  </InfoRow>
                );
              })}
              <InfoRow
                label="Beat-that-sold review"
                tooltip="A buy writes a review for a beat the stock fell 3%+ on."
                border={false}
              >
                <Switch
                  checked={beatAndFade}
                  disabled={!canEdit || pending}
                  onCheckedChange={(c) => setBeatAndFade(!!c)}
                />
              </InfoRow>
            </div>
          </div>

          {canEdit ? (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => submit(setup.defaults)}
                disabled={pending || setup.overridden.length === 0}
              >
                Reset to the playbook
              </Button>
              <Button size="sm" onClick={save} disabled={pending || !dirty}>
                Save
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only the account owner can change these numbers.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

export function PlaybookSetupsForm({
  initial,
  canEdit,
}: {
  initial: PlaybookSetupView[];
  canEdit: boolean;
}) {
  const [setups, setSetups] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = setups.find((s) => s.id === openId) ?? null;

  return (
    <>
      {setups.map((s) => (
        <SetupRow key={s.id} setup={s} onOpen={() => setOpenId(s.id)} />
      ))}
      {open ? (
        <SetupSheet
          // Remount on setup change so the inputs start from that setup's values.
          key={open.id}
          setup={open}
          canEdit={canEdit}
          open
          onOpenChange={(v) => !v && setOpenId(null)}
          onSaved={(v) =>
            setSetups((list) => list.map((x) => (x.id === v.id ? v : x)))
          }
        />
      ) : null}
    </>
  );
}
