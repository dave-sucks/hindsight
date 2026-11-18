"use client";

/**
 * One agent's request to the model, drawn as squares of 1,000 characters,
 * beside its parts. Every agent is a tab, read from its record the same way:
 * its parts in the record's order, under where each goes (its instructions,
 * its first message, each new message of a conversation), then its tools.
 * Each part is sized on the request the engine built on the agent's sample
 * day (lib/docs/framework.ts). Hovering a line lights its squares.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WHERE_LABEL, type FrameworkAgent, type FrameworkData, type FrameworkPart, type FrameworkWhere } from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { Mono } from "../primitives";
import { SWATCH, type PartId } from "./swatch";

/** A line of the list: a part of the request, or the tool menu. */
interface Row {
  key: string;
  swatch: PartId;
  title: string;
  chars: number | null;
  body: string;
  foot: string;
  /** What its size says when it has none. */
  unsized: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
/** Squares for a size: one per 1,000 characters, and one for a part smaller than that so it can be found. */
const squaresOf = (n: number | null) => (n ? Math.max(1, Math.round(n / 1000)) : 0);
const steps = (a: FrameworkAgent) => (a.maxSteps === 1 ? "one call" : `up to ${a.maxSteps} steps`);

function rowOf(p: FrameworkPart, sampled: boolean): Row {
  const own = p.kind === "own";
  const body = own ? (p.about ? `“${p.about}”` : "Sent only on some runs.") : p.about;
  const foot = own ? `Its own words${p.perRun ? ", written for each run" : ""} · ${p.source}` : `From the block library · ${p.source}`;
  return { key: `${p.where}:${p.id}`, swatch: p.swatch, title: p.title, chars: p.chars, body, foot, unsized: sampled ? "Not on the sample" : "Not sized" };
}

function toolsRow(a: FrameworkAgent): Row | null {
  const { names, chars, unmeasured, provider } = a.tools;
  if (!names.length && !provider.length) return null;
  const lines = [
    names.length ? `${names.length} tool${names.length === 1 ? "" : "s"}, each described in full on every request, used or not: ${names.join(", ")}.` : null,
    provider.length ? `The model provider's own: ${provider.join(", ")}.` : null,
    unmeasured.length ? `Not sized here: ${unmeasured.join(", ")}, made by its run.` : null,
  ];
  return { key: "tools", swatch: "tools", title: "Tool menu", chars, body: lines.filter(Boolean).join(" "), foot: "From its record's tool list · lib/agent/tools", unsized: "Not sized" };
}

export function RequestGrid({ data }: { data: FrameworkData }) {
  const [id, setId] = useState(data.agents[0]?.id ?? "");
  const [hover, setHover] = useState<string | null>(null);
  const agent = data.agents.find((a) => a.id === id) ?? data.agents[0];
  if (!agent) return null;

  const groups = (Object.keys(WHERE_LABEL) as FrameworkWhere[])
    .map((where) => ({ where, rows: agent.parts.filter((p) => p.where === where).map((p) => rowOf(p, agent.sample != null)) }))
    .filter((g) => g.rows.length);
  const tools = toolsRow(agent);
  const rows = [...groups.flatMap((g) => g.rows), ...(tools ? [tools] : [])];
  const cells = rows.flatMap((r) => Array<Row>(squaresOf(r.chars)).fill(r));
  const total = rows.reduce((n, r) => n + (r.chars ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="overflow-x-auto pb-1">
          <Tabs
            value={agent.id}
            onValueChange={(v) => {
              setId(String(v));
              setHover(null);
            }}
          >
            <TabsList size="sm">
              {data.agents.map((a) => (
                <TabsTrigger key={a.id} value={a.id}>
                  {a.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">{agent.does}</span> {agent.runsWhen} Model {agent.model}, {steps(agent)}.{" "}
          <Link href="/how-it-works/agents" className="inline-flex items-center gap-0.5 hover:text-foreground">
            Its record
            <ArrowUpRight className="size-3" />
          </Link>
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col">
          {groups.map((g, i) => (
            <div key={g.where} className={cn("flex flex-col", i > 0 && "pt-6")}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{WHERE_LABEL[g.where]}</p>
              <ul className="flex flex-col">
                {g.rows.map((r) => (
                  <PartRow key={r.key} row={r} hover={hover} setHover={setHover} />
                ))}
              </ul>
            </div>
          ))}
          {tools ? (
            <div className="flex flex-col pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Its tools</p>
              <ul className="flex flex-col">
                <PartRow row={tools} hover={hover} setHover={setHover} />
                <li className="flex flex-col gap-1 border-b border-dashed py-3">
                  <span className="text-sm font-medium text-foreground">What its tools bring back</span>
                  <span className="text-sm text-muted-foreground">
                    Every result joins the conversation and is sent again on each request after it. It grows as the run goes, so it isn&apos;t drawn.
                  </span>
                </li>
              </ul>
            </div>
          ) : null}
        </div>

        <div
          className="flex min-w-0 flex-col gap-5 self-start rounded-2xl border bg-muted/40 p-5 sm:p-6 lg:sticky lg:top-6"
          style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{agent.name}</span>
            <Mono className="text-xs text-muted-foreground tabular-nums">{agent.sample ? `${fmt(total)} characters` : "Not sized"}</Mono>
          </div>
          {cells.length ? (
            <div className="grid grid-cols-12 gap-1 sm:grid-cols-16 sm:gap-1.5" aria-hidden>
              {cells.map((r, i) => (
                <span
                  key={`${agent.id}-${i}`}
                  className={cn(
                    "aspect-square rounded-sm transition-opacity duration-300 animate-in fade-in-0 zoom-in-50",
                    SWATCH[r.swatch].className,
                    hover && hover !== r.key && "opacity-15",
                  )}
                  style={{ ...SWATCH[r.swatch].style, animationDelay: `${Math.min(i * 4, 900)}ms`, animationFillMode: "backwards" }}
                />
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {agent.sample
              ? `Built by the engine from its record on a sample day: ${agent.sample}. Its own words and the house rules are the same on every run; a block that holds data is the sample's size, and that day's on a real run. `
              : "It has no sample day, so its parts are drawn from its record without sizes. "}
            Each square is 1,000 characters, about 250 tokens; a part under 1,000 is one square, so it can be found. Point at a line to find its squares.
          </p>
        </div>
      </div>
    </div>
  );
}

function PartRow({ row, hover, setHover }: { row: Row; hover: string | null; setHover: (key: string | null) => void }) {
  const sw = SWATCH[row.swatch];
  return (
    <li
      className={cn("flex flex-col gap-1 border-b py-3 transition-opacity", hover && hover !== row.key && "opacity-50")}
      onMouseEnter={() => setHover(row.key)}
      onMouseLeave={() => setHover(null)}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("size-2.5 shrink-0 rounded-[3px]", sw.className)} style={sw.style} />
        <span className="text-sm font-medium text-foreground">{row.title}</span>
        <span className="ml-auto shrink-0 text-sm text-foreground tabular-nums">{row.chars != null ? fmt(row.chars) : row.unsized}</span>
      </div>
      <p className="break-words pl-5 text-sm text-muted-foreground">{row.body}</p>
      <p className="break-words pl-5 text-xs text-muted-foreground">{row.foot}</p>
    </li>
  );
}
