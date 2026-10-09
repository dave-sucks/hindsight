"use client";

/**
 * The tool catalog: a filterable grid of every tool an agent can call, each
 * opening a dialog with which agents have it and where it reads from. The
 * list arrives built on the server (lib/docs/tool-catalog.ts) through
 * DocsDataProvider, so which agent has which tool is read from the code.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HindsightLogo from "@/components/HindsightLogo";
import {
  DOCS_AGENTS,
  TOOL_KINDS,
  TOOL_SOURCES,
  type CatalogTool,
  type DocsAgentId,
  type DocsSetup,
  type ToolKind,
  type ToolSource,
} from "@/lib/docs/tools";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";

// ── Data ───────────────────────────────────────────────────────────────────

interface DocsDataValue {
  tools: readonly CatalogTool[];
  setups: readonly DocsSetup[];
}

const DocsData = createContext<DocsDataValue>({ tools: [], setups: [] });

/** What the docs read from the code, built on the server and handed down once. */
export function DocsDataProvider({ tools, setups, children }: DocsDataValue & { children: ReactNode }) {
  const value = useMemo(() => ({ tools, setups }), [tools, setups]);
  return <DocsData.Provider value={value}>{children}</DocsData.Provider>;
}

export function useDocsSetups(): readonly DocsSetup[] {
  return useContext(DocsData).setups;
}

export function useDocsTools(agent?: DocsAgentId): readonly CatalogTool[] {
  const { tools } = useContext(DocsData);
  return agent ? tools.filter((t) => t.agents.includes(agent)) : tools;
}

// ── Source mark ────────────────────────────────────────────────────────────

const FAVICON: Partial<Record<ToolSource, string>> = {
  alpaca: "alpaca.markets",
  finnhub: "finnhub.io",
  sec: "sec.gov",
  perplexity: "perplexity.ai",
  anthropic: "anthropic.com",
  xai: "x.ai",
  inngest: "inngest.com",
};

/** A source's mark: the vendor's favicon, or Hindsight's own logo for our database. `xs` is the bare icon, for a line of text. */
export function SourceMark({ source, size = "md" }: { source: ToolSource; size?: "xs" | "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "size-10 rounded-xl" : size === "sm" ? "size-5 rounded-md" : size === "xs" ? "" : "size-8 rounded-lg";
  const img = size === "lg" ? "size-5" : size === "sm" || size === "xs" ? "size-3" : "size-4";
  const domain = FAVICON[source];
  return (
    <span className={cn("grid shrink-0 place-items-center", size !== "xs" && "border bg-background", box)} title={TOOL_SOURCES[source]}>
      {domain ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt="" className={cn("rounded-sm", img)} />
      ) : (
        <HindsightLogo className={cn("text-brand", img)} />
      )}
    </span>
  );
}

// ── Card + grid ────────────────────────────────────────────────────────────

function ToolCard({ tool, onOpen }: { tool: CatalogTool; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-left transition hover:-translate-y-px hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3">
        <SourceMark source={tool.sources[0]} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{tool.name}</span>
          <Mono className="truncate text-xs text-muted-foreground">{tool.code}</Mono>
        </div>
        {tool.approval ? <ShieldCheck className="ml-auto size-4 shrink-0 text-amber-500" aria-label="Needs your approval" /> : null}
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{tool.summary}</p>
    </button>
  );
}

/** A plain grid of tools that open the dialog. Used by pages that show one agent's tools. */
export function ToolGrid({ tools }: { tools: readonly CatalogTool[] }) {
  const [open, setOpen] = useState<CatalogTool | null>(null);
  return (
    <>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <ToolCard key={t.code} tool={t} onOpen={() => setOpen(t)} />
        ))}
      </div>
      <ToolDialog tool={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Tools as rows: the mark, the name, the machine name, one line of what it does. Opens the dialog. */
export function ToolList({ tools }: { tools: readonly CatalogTool[] }) {
  const [open, setOpen] = useState<CatalogTool | null>(null);
  return (
    <>
      <ul className="flex flex-col divide-y rounded-xl border">
        {tools.map((t) => (
          <li key={t.code}>
            <button
              type="button"
              onClick={() => setOpen(t)}
              className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <SourceMark source={t.sources[0]} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="shrink-0 text-sm font-medium text-foreground sm:w-44">{t.name}</span>
                <span className="min-w-0 truncate text-sm text-muted-foreground">{t.summary}</span>
              </span>
              <Mono className="hidden shrink-0 text-xs text-muted-foreground md:inline">{t.code}</Mono>
              {t.approval ? <ShieldCheck className="size-4 shrink-0 text-amber-500" aria-label="Needs your approval" /> : null}
            </button>
          </li>
        ))}
      </ul>
      <ToolDialog tool={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** One agent's tools, read from the code, as rows. */
export function AgentTools({ agent }: { agent: DocsAgentId }) {
  return <ToolList tools={useDocsTools(agent)} />;
}

// ── Dialog ─────────────────────────────────────────────────────────────────

export function ToolDialog({ tool, onClose }: { tool: CatalogTool | null; onClose: () => void }) {
  return (
    <Dialog open={tool != null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent size="lg">{tool ? <ToolDialogBody tool={tool} /> : null}</DialogContent>
    </Dialog>
  );
}

function ToolDialogBody({ tool }: { tool: CatalogTool }) {
  const kind = TOOL_KINDS.find((k) => k.id === tool.kind);
  return (
    <div className="flex max-h-[75vh] min-w-0 flex-col gap-5 overflow-y-auto">
      <DialogHeader>
        <div className="flex items-start gap-3">
          <SourceMark source={tool.sources[0]} size="lg" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle>{tool.name}</DialogTitle>
            <Mono className="text-xs text-muted-foreground">{tool.code}</Mono>
          </div>
        </div>
        <DialogDescription>{tool.summary}</DialogDescription>
      </DialogHeader>

      {tool.approval ? (
        <div className="flex items-start gap-2.5 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>Needs your approval. It becomes a proposal in your queue, with an email and a phone alert, and expires after 24 hours if you don&apos;t answer.</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available to</p>
        <div className="flex flex-wrap gap-1.5">
          {DOCS_AGENTS.map((a) => (
            <Badge key={a.id} variant={tool.agents.includes(a.id) ? "outline" : "muted"}>
              {tool.agents.includes(a.id) ? a.name : <span className="line-through decoration-muted-foreground/40">{a.name}</span>}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kind · sources</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {kind ? <Badge variant="secondary">{kind.name}</Badge> : null}
          {tool.sources.map((s) => (
            <Badge key={s} variant="outline">
              {TOOL_SOURCES[s]}
            </Badge>
          ))}
        </div>
      </div>

      {tool.resources?.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Where it reads from</p>
          <Tabs defaultValue={0}>
            <TabsList variant="line">
              {tool.resources.map((r, i) => (
                <TabsTrigger key={r.title} value={i}>
                  {r.title}
                </TabsTrigger>
              ))}
            </TabsList>
            {tool.resources.map((r, i) => (
              <TabsContent key={r.title} value={i}>
                <div className="flex flex-col gap-2 pt-2">
                  <p className="text-sm text-muted-foreground">{r.description}</p>
                  <Mono as="pre" className="overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 text-xs text-foreground">{r.endpoint}</Mono>
                  {r.example ? (
                    <Mono as="pre" className="overflow-x-auto rounded-lg bg-positive/10 px-3 py-2 text-xs text-positive">{r.example}</Mono>
                  ) : null}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      ) : null}

      {tool.notes?.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {tool.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── The full catalog ───────────────────────────────────────────────────────

export function ToolCatalog({ searchRef }: { searchRef?: React.Ref<HTMLInputElement> }) {
  const tools = useDocsTools();
  const [agent, setAgent] = useState<DocsAgentId | "all">("all");
  const [kind, setKind] = useState<ToolKind | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CatalogTool | null>(null);

  const query = q.trim().toLowerCase();
  const shown = tools.filter(
    (t) =>
      (agent === "all" || t.agents.includes(agent)) &&
      (!kind || t.kind === kind) &&
      (!query || `${t.name} ${t.code} ${t.summary}`.toLowerCase().includes(query)),
  );
  const agentOptions = [
    { value: "all" as const, label: `All agents · ${tools.length}` },
    ...DOCS_AGENTS.map((a) => ({ value: a.id, label: `${a.name} · ${tools.filter((t) => t.agents.includes(a.id)).length}` })),
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="max-w-full overflow-x-auto">
          <ChipTabs
            variant="tray"
            options={agentOptions}
            value={agent}
            clearable={false}
            onChange={(v) => setAgent((v ?? "all") as DocsAgentId | "all")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ChipTabs options={TOOL_KINDS.map((k) => ({ value: k.id, label: k.short }))} value={kind} onChange={setKind} />
          <div className="ml-auto w-full sm:w-64">
            <label htmlFor="docs-tool-search" className="sr-only">
              Search tools
            </label>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput id="docs-tool-search" ref={searchRef} type="search" placeholder="Search tools" value={q} onChange={(e) => setQ(e.target.value)} />
            </InputGroup>
          </div>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          Showing {shown.length} of {tools.length} tools
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No tool matches. Clear the search or pick another agent.
        </p>
      ) : (
        TOOL_KINDS.map((k) => {
          const items = shown.filter((t) => t.kind === k.id);
          if (items.length === 0) return null;
          return (
            <div key={k.id} className="flex flex-col gap-3">
              <p className="flex items-baseline gap-2 text-sm font-medium text-foreground">
                {k.name}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{items.length}</span>
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((t) => (
                  <ToolCard key={t.code} tool={t} onOpen={() => setOpen(t)} />
                ))}
              </div>
            </div>
          );
        })
      )}
      <ToolDialog tool={open} onClose={() => setOpen(null)} />
    </div>
  );
}
