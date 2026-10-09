"use client";

/**
 * The plain parts of a doc page: a title, headings, paragraphs, lists, a few
 * example prompts, and the inline references that name a tool or another
 * agent inside a sentence. Docs are mostly text; the visual assets sit
 * between paragraphs where a picture explains faster.
 *
 *   <P>It pulls <ToolRef name="get_market_movers" /> and sends the best to <AgentRef slug="writer" />.</P>
 *
 * A ToolRef opens the tool's dialog. An AgentRef opens that agent's page, in
 * the sheet on /docs or as its own page on /docs/<slug>.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, PenLine, Search, Sun, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";
import { SourceMark, ToolDialog, useDocsTools } from "./tool-catalog";

/** The page's title and the one paragraph that says what the thing is. */
export function DocTitle({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <header className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kicker}</p>
      <h2 className="text-3xl font-medium tracking-tight text-foreground">{title}</h2>
      <p className="max-w-[60ch] text-base leading-7 text-muted-foreground">{children}</p>
    </header>
  );
}

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-20 text-lg font-medium text-foreground">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[65ch] text-sm leading-7 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">{children}</p>;
}

export function Ul({ children }: { children: ReactNode }) {
  return (
    <ul className="flex max-w-[65ch] list-disc flex-col gap-1.5 pl-5 text-sm leading-7 text-muted-foreground marker:text-muted-foreground/50 [&_strong]:font-medium [&_strong]:text-foreground">
      {children}
    </ul>
  );
}

/** "Try asking": prompts the reader can copy into chat. */
export function Prompts({ items }: { items: readonly string[] }) {
  return (
    <div className="flex max-w-[65ch] flex-col gap-2 border-l-2 pl-4">
      {items.map((p) => (
        <p key={p} className="text-sm leading-6 text-foreground">
          {p}
        </p>
      ))}
    </div>
  );
}

/** One block of doc text: a heading and what follows it, spaced like a page. */
export function DocSection({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <H2 id={id}>{title}</H2>
      {children}
    </section>
  );
}

const pill = "mx-0.5 inline-flex items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-px align-baseline text-xs leading-5 text-foreground transition-colors";

/** A tool named in a sentence: its source's logo and its name. Opens the tool's dialog. */
export function ToolRef({ name }: { name: string }) {
  const tool = useDocsTools().find((t) => t.code === name);
  const [open, setOpen] = useState(false);
  if (!tool) return <Mono className={pill}>{name}</Mono>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(pill, "hover:bg-muted")} title={tool.summary}>
        <SourceMark source={tool.sources[0]} size="xs" />
        <Mono>{name}</Mono>
      </button>
      <ToolDialog tool={open ? tool : null} onClose={() => setOpen(false)} />
    </>
  );
}

const AGENTS: Record<string, { title: string; icon: LucideIcon }> = {
  discovery: { title: "Discovery", icon: Search },
  writer: { title: "the Writer", icon: PenLine },
  "morning-runs": { title: "the morning run", icon: Sun },
  "trigger-runs": { title: "the trigger run", icon: Zap },
  chat: { title: "chat", icon: MessageCircle },
};

/** Another agent named in a sentence. Opens its page. */
export function AgentRef({ slug, children }: { slug: keyof typeof AGENTS; children?: ReactNode }) {
  const pathname = usePathname();
  const a = AGENTS[slug];
  const href = pathname === "/docs" ? `/docs?doc=${slug}` : `/docs/${slug}`;
  return (
    <Link href={href} scroll={false} className={cn(pill, "font-medium hover:bg-muted")}>
      <a.icon className="size-3 text-muted-foreground" />
      {children ?? a.title}
    </Link>
  );
}
