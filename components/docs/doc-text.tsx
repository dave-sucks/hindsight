"use client";

/**
 * The plain parts of a doc page: headings, paragraphs, lists, a few
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
import { CheckCircle2, FileText, Flag, Layers, MessageCircle, PenLine, Search, Sun, UserRound, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMock, type ChatStep } from "./chat-mock";
import { Mono } from "./primitives";
import { SourceMark, ToolDialog, useDocsTools } from "./tool-catalog";

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-20 text-lg font-medium text-foreground">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">{children}</p>;
}

export function Ul({ children }: { children: ReactNode }) {
  return (
    <ul className="flex max-w-[65ch] list-disc flex-col gap-1 pl-5 text-sm leading-6 text-muted-foreground marker:text-muted-foreground/50 [&_strong]:font-medium [&_strong]:text-foreground">
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
    <section className="flex flex-col gap-3">
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

const REFS: Record<string, { title: string; icon: LucideIcon }> = {
  discovery: { title: "Discovery", icon: Search },
  writer: { title: "the Writer", icon: PenLine },
  "morning-runs": { title: "the morning run", icon: Sun },
  "trigger-runs": { title: "the trigger run", icon: Zap },
  chat: { title: "chat", icon: MessageCircle },
  theses: { title: "theses", icon: FileText },
  triggers: { title: "triggers", icon: Zap },
  analysts: { title: "analysts", icon: UserRound },
  situations: { title: "situations", icon: Flag },
  approvals: { title: "approvals", icon: CheckCircle2 },
  "under-the-hood": { title: "under the hood", icon: Layers },
};

/** Another page named in a sentence, an agent or a concept. Opens it. */
export function DocRef({ slug, children }: { slug: keyof typeof REFS; children?: ReactNode }) {
  const pathname = usePathname();
  const a = REFS[slug];
  const href = pathname === "/docs" ? `/docs?doc=${slug}` : `/docs/${slug}`;
  return (
    <Link href={href} scroll={false} className={cn(pill, "font-medium hover:bg-muted")}>
      <a.icon className="size-3 text-muted-foreground" />
      {children ?? a.title}
    </Link>
  );
}

/** The older name, for pages written before concepts could be linked too. */
export const AgentRef = DocRef;

/** A conversation shown as the docs' one kind of picture: the chat on the dotted ground, nothing around it. */
export function ChatExample({ steps, caption }: { steps: readonly ChatStep[]; caption?: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <div
        className="rounded-2xl border bg-muted/40 px-4 py-6 sm:px-10"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        <div className="mx-auto max-w-2xl">
          <ChatMock title={caption ?? "Example"} steps={steps} bare />
        </div>
      </div>
      {caption ? <figcaption className="text-xs text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}
