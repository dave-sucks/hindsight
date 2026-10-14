"use client";

/**
 * /docs and /docs/[slug]: a classic docs page. Every doc in the sidebar,
 * grouped the way docs/guide/ is foldered; the doc in the middle; its
 * sections on the right. The Overview is the guide's README, the page an
 * agent starts from.
 */

import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { CatalogTool, DocsSetup } from "@/lib/docs/tools";
import { headingId, parseDoc } from "@/lib/docs/guide-parse";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { DocCrumbs } from "./doc-crumbs";
import { MarkdownDoc } from "./markdown-doc";
import { DOCS, docBySlug, type DocMeta } from "./registry";
import { DocsDataProvider } from "./tool-catalog";

/** The README is the Overview; it lives at /docs. */
export const OVERVIEW = "README";

const GROUPS: ReadonlyArray<{ label: string; group: DocMeta["group"] }> = [
  { label: "Start here", group: "Overview" },
  { label: "Agents", group: "Agents" },
  { label: "Concepts", group: "Concepts" },
  { label: "Reference", group: "Reference" },
];

const hrefOf = (slug: string) => (slug === OVERVIEW ? "/docs" : `/docs/${slug}`);

export function DocsHub({
  slug,
  tools,
  setups,
  guide,
}: {
  slug: string;
  tools: readonly CatalogTool[];
  setups: readonly DocsSetup[];
  guide: Readonly<Record<string, string>>;
}) {
  const meta = docBySlug(slug);
  const source = guide[slug] ?? "";
  const sections = parseDoc(source).parts.flatMap((p) => (p.kind === "section" && p.title ? [p.title] : []));

  return (
    <DocsDataProvider tools={tools} setups={setups} guide={guide}>
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 pb-32 pt-6 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12 lg:pt-10 xl:grid-cols-[14rem_minmax(0,1fr)_12rem]">
        <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
          {/* On a phone the list folds away behind one line. */}
          <div className="lg:hidden">
            <Collapsible>
              <CollapsibleTrigger className="group/nav flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium text-foreground">
                {meta?.title ?? "Overview"}
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[panel-open]/nav:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pt-4">
                  <DocsSidebar active={slug} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <div className="hidden lg:block">
            <DocsSidebar active={slug} />
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-8">
          <DocCrumbs group={meta ? GROUPS.find((g) => g.group === meta.group)?.label ?? meta.group : "Start here"} title={meta?.title ?? "Overview"} groupHref="/docs" />
          <MarkdownDoc source={source} />
        </main>

        {sections.length ? (
          <nav aria-label="On this page" className="hidden xl:sticky xl:top-6 xl:flex xl:max-h-[calc(100vh-3rem)] xl:flex-col xl:gap-2 xl:self-start xl:overflow-y-auto">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On this page</p>
            {sections.map((t) => (
              <a key={t} href={`#${headingId(t)}`} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                {t}
              </a>
            ))}
          </nav>
        ) : null}
      </div>
    </DocsDataProvider>
  );
}

function DocsSidebar({ active }: { active: string }) {
  return (
    <nav aria-label="Docs" className="flex flex-col gap-6">
      {GROUPS.map((g) => {
        const docs = DOCS.filter((d) => d.group === g.group);
        const items = g.group === "Overview" ? [{ slug: OVERVIEW, title: "Overview" }, ...docs] : docs;
        return (
          <div key={g.label} className="flex flex-col gap-1">
            <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
            {items.map((d) => (
              <Link
                key={d.slug}
                href={hrefOf(d.slug)}
                aria-current={d.slug === active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm transition-colors",
                  d.slug === active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d.title}
              </Link>
            ))}
          </div>
        );
      })}
      <div className="flex flex-col gap-1 border-t pt-4">
        {[
          { href: "/how-it-works", label: "How it works" },
          { href: "/how-it-works/framework", label: "The Framework" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            {l.label}
            <ArrowUpRight className="size-3.5" />
          </Link>
        ))}
      </div>
    </nav>
  );
}
