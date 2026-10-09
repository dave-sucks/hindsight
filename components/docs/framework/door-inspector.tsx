"use client";

/**
 * Every door, opened like an agent's settings panel: what wakes it, its
 * model, its job, the shared parts it carries and its tools. The model, the
 * step limit, the tool list and both sizes are measured from the code on the
 * server; whether it carries the house rules is read off its prompt.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, Check, Clock, MessageCircle, Minus, Search, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { DOOR_COPY, type FrameworkData, type FrameworkDoorId } from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { Mono } from "../primitives";

const ICON: Record<FrameworkDoorId, LucideIcon> = {
  morning: Clock,
  trigger: Zap,
  chat: MessageCircle,
  discovery: Search,
  writer: Sparkles,
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function DoorInspector({ data }: { data: FrameworkData }) {
  const [id, setId] = useState<FrameworkDoorId>("morning");
  const door = data.doors.find((d) => d.id === id) ?? data.doors[0];
  const copy = DOOR_COPY[door.id];
  const max = Math.max(...data.doors.flatMap((d) => [d.promptChars ?? 0, d.toolChars ?? 0]));

  const shared: Array<{ label: string; on: boolean | null; text: string }> = [
    {
      label: "House rules",
      on: door.houseRules,
      text: door.houseRules ? `In its prompt, ${fmt(data.houseRulesChars)} characters.` : "Not in its prompt yet. #817 adds them here.",
    },
    { label: "Analyst brief", on: true, text: copy.analyst },
    { label: "The read", on: true, text: copy.read },
    { label: "The save", on: true, text: copy.save },
  ];

  return (
    <div className="grid overflow-hidden rounded-2xl border bg-card md:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="flex gap-1 overflow-x-auto border-b bg-muted/30 p-2 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3">
        <p className="hidden px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground md:block">Doors</p>
        {data.doors.map((d) => {
          const Icon = ICON[d.id];
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setId(d.id)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                d.id === id ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {DOOR_COPY[d.id].name}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-col gap-6 p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-muted text-foreground">
            <Bot className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xl font-medium tracking-tight text-foreground">{copy.name}</p>
            <p className="text-sm text-muted-foreground">{copy.woken}</p>
          </div>
        </div>

        <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          <Cell label="Model">
            <Mono className="text-sm text-foreground">{door.model}</Mono>
          </Cell>
          <Cell label="Steps">
            <span className="text-sm text-foreground tabular-nums">Up to {door.maxSteps}</span>
          </Cell>
          <Cell label="Its job" wide>
            <span className="text-sm text-foreground">{copy.job}</span>
          </Cell>
        </dl>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Shared parts, defined once</p>
          <ul className="flex flex-col divide-y rounded-xl border">
            {shared.map((s) => (
              <li key={s.label} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                    s.on ? "bg-blue-500/15 text-blue-500" : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.on ? <Check className="size-3" /> : <Minus className="size-3" />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{s.label}</span>
                  <span className="text-sm text-muted-foreground">{s.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tools · {door.tools.length}</p>
            <Link href="/docs#tools" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Open the catalog
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {door.tools.map((t) => (
              <Mono key={t} className="rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground">
                {t}
              </Mono>
            ))}
          </div>
          {door.id === "writer" ? (
            <p className="text-sm text-muted-foreground">Its data tools run in code before it writes; the model itself gets web search and the tool that saves the thesis.</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t pt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What it sends before reading a single stock</p>
          <SizeBar label="Prompt" chars={door.promptChars} max={max} className="bg-foreground/70" />
          <SizeBar label="Tool menu" chars={door.toolChars} max={max} striped />
          <p className="text-xs text-muted-foreground">Characters, measured from this deploy with the same sample analyst the size test uses.</p>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1 bg-card px-4 py-3", wide && "sm:col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function SizeBar({ label, chars, max, className, striped }: { label: string; chars: number | null; max: number; className?: string; striped?: boolean }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-muted">
        {chars != null ? (
          <span
            className={cn("block h-full rounded-full transition-[width] duration-500", striped ? "border border-muted-foreground/40" : className)}
            style={{
              width: `${Math.max(2, (chars / max) * 100)}%`,
              ...(striped ? { backgroundImage: "repeating-linear-gradient(135deg, var(--muted-foreground) 0 1.5px, transparent 1.5px 4px)" } : {}),
            }}
          />
        ) : null}
      </span>
      <span className="text-right text-foreground tabular-nums">{chars != null ? fmt(chars) : "—"}</span>
    </div>
  );
}
