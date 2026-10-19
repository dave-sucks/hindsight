/**
 * /docs: the front door. Where to start, then the two halves of the guide
 * as two cards, so the first thing learned is that an agent (something
 * that runs) and a concept (something it works on) are different kinds of
 * thing. Every row opens its doc in the hub.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { parseDoc } from "@/lib/docs/guide-parse";
import { Mono } from "./primitives";
import { DOCS, type DocMeta } from "./registry";

const START: ReadonlyArray<{ href: string; title: string; blurb: string }> = [
  { href: "/docs/overview", title: "Overview", blurb: "The whole system on one page. Read this first; so does every agent." },
  { href: "/docs/architecture", title: "Architecture", blurb: "How the pieces fit, and the one place each thing is defined." },
  { href: "/docs/glossary", title: "Glossary", blurb: "Every term the app, the docs and the agents use, a sentence each." },
];

/** When each agent starts, from the facts strip at the top of its doc. */
function startsOf(guide: Readonly<Record<string, string>>, slug: string): string | undefined {
  for (const part of parseDoc(guide[slug] ?? "").parts) {
    if (part.kind !== "section") continue;
    for (const b of part.blocks) if (b.kind === "facts") return b.facts.find(([k]) => k === "Starts")?.[1];
  }
  return undefined;
}

export function DocsIndex({ guide }: { guide: Readonly<Record<string, string>> }) {
  const agents = DOCS.filter((d) => d.group === "Agents");
  const concepts = DOCS.filter((d) => d.group === "Concepts");
  const groups = (["Deep dives", "Reference"] as const).map((g) => ({ title: g, docs: DOCS.filter((d) => d.group === g) }));

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Hindsight Docs</h1>
        <p className="text-sm text-muted-foreground">The agents that do the work, the things they work on, and how it all fits.</p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Start here</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {START.map((s) => (
            <Link key={s.href} href={s.href} className="flex flex-col gap-1.5 rounded-lg border p-5 transition-colors hover:bg-muted/50">
              <span className="text-sm font-medium text-foreground">{s.title}</span>
              <span className="text-sm text-muted-foreground">{s.blurb}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Learn</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Course
            n="01"
            title="Agents"
            blurb="Who does the work. Each one starts on its own clock or at your word, reads what it needs and saves what it decides."
            docs={agents}
            meta={(d) => startsOf(guide, d.slug)}
          />
          <Course
            n="02"
            title="Concepts"
            blurb="What they work on. The things an agent reads and saves, the rules it follows, and the one thing you answer."
            docs={concepts}
          />
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">{g.title}</h2>
          <div className="flex flex-col border-t">
            {g.docs.map((d) => (
              <Link key={d.slug} href={`/docs/${d.slug}`} className="flex flex-col gap-1 border-b py-3 transition-colors hover:text-foreground sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                <span className="shrink-0 text-sm font-medium text-foreground">{d.title}</span>
                <span className="text-sm text-muted-foreground sm:text-right">{d.blurb}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One half of the guide, as Gumloop University lays out a course: a name, a line, its lessons numbered. */
function Course({
  n,
  title,
  blurb,
  docs,
  meta,
}: {
  n: string;
  title: string;
  blurb: string;
  docs: readonly DocMeta[];
  meta?: (d: DocMeta) => string | undefined;
}) {
  return (
    <div className="flex flex-col rounded-lg border p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-medium text-foreground">{title}</h3>
        <Mono className="text-xs text-muted-foreground">{n}</Mono>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>
      <ol className="mt-6 flex flex-col border-t">
        {docs.map((d, i) => (
          <li key={d.slug} className="border-b">
            <Link href={`/docs/${d.slug}`} className="group/row flex items-baseline gap-4 py-2.5 text-sm">
              <Mono className="text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</Mono>
              <span className="text-foreground transition-colors group-hover/row:text-muted-foreground">{d.title}</span>
              {meta?.(d) ? <Mono className="ml-auto text-xs uppercase tracking-wide text-muted-foreground">{meta(d)}</Mono> : null}
            </Link>
          </li>
        ))}
      </ol>
      <div className="mt-auto flex items-center justify-between pt-6">
        <Link href={`/docs/${docs[0]?.slug}`} className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-muted-foreground">
          Start with {docs[0]?.title}
          <ArrowRight className="size-3.5" />
        </Link>
        <span className="text-xs text-muted-foreground">{docs.length} docs</span>
      </div>
    </div>
  );
}
