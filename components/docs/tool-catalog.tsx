"use client";

/**
 * The tool catalog: every tool an agent can call, filtered by kind, each
 * opening a dialog with what it does and where it reads from. Which agent
 * has a tool shows on that agent's page. The
 * list arrives built on the server (lib/docs/tool-catalog.ts) through
 * DocsDataProvider, so which agent has which tool is read from the code.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import HindsightLogo from "@/components/HindsightLogo";
import {
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
      className="flex min-w-0 items-start gap-3 rounded-xl border bg-background p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SourceMark source={tool.sources[0]} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{tool.name}</span>
        <span className="line-clamp-2 text-sm text-muted-foreground">{tool.summary}</span>
      </span>
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
  const [r, setR] = useState(0);
  const res = tool.resources?.[r];
  return (
    <div className="flex max-h-[75vh] min-w-0 flex-col gap-5 overflow-y-auto">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <SourceMark source={tool.sources[0]} />
          <div className="flex min-w-0 flex-col">
            <DialogTitle>{tool.name}</DialogTitle>
            <Mono className="text-xs text-muted-foreground">{tool.code}</Mono>
          </div>
        </div>
        <DialogDescription>{tool.summary}</DialogDescription>
      </DialogHeader>

      {tool.resources?.length ? (
        <div className="flex flex-col gap-3">
          {tool.resources.length > 1 ? (
            <ChipTabs
              options={tool.resources.map((x, i) => ({ value: String(i), label: x.title }))}
              value={String(r)}
              onChange={(v) => v != null && setR(Number(v))}
              clearable={false}
            />
          ) : null}
          {res ? (
            <>
              <p className="text-sm text-muted-foreground">{res.description}</p>
              <Mono as="pre" className="overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 text-xs text-foreground">
                {res.endpoint}
              </Mono>
              {res.example ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Example</p>
                  <p className="text-sm text-foreground">{res.example}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {tool.approval || tool.notes?.length ? (
        <div className="flex flex-col gap-1.5 border-t pt-4 text-sm text-muted-foreground">
          {tool.approval ? <p>Needs your approval: it becomes a proposal in your queue, and expires after 24 hours if you don&apos;t answer.</p> : null}
          {tool.notes?.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── The full catalog ───────────────────────────────────────────────────────

export function ToolCatalog() {
  const tools = useDocsTools();
  const [kind, setKind] = useState<ToolKind | "all">("all");
  const [open, setOpen] = useState<CatalogTool | null>(null);
  // One list in the catalog's own order: market data first, then the book, edits, trades and run steps.
  const order = TOOL_KINDS.map((k) => k.id);
  const shown = tools.filter((t) => kind === "all" || t.kind === kind).toSorted((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return (
    <div className="flex flex-col gap-5">
      <ChipTabs
        options={[{ value: "all", label: "All" }, ...TOOL_KINDS.map((k) => ({ value: k.id, label: k.short }))]}
        value={kind}
        onChange={(v) => v && setKind(v as ToolKind | "all")}
        clearable={false}
      />
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((t) => (
          <ToolCard key={t.code} tool={t} onOpen={() => setOpen(t)} />
        ))}
      </div>
      <ToolDialog tool={open} onClose={() => setOpen(null)} />
    </div>
  );
}
