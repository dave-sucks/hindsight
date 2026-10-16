"use client";

/**
 * /docs and /docs/[slug]: the doc in the middle, its sections on the
 * right; the list of every doc is the docs' own sidebar (DocsSidebar).
 * /docs itself is the front door (DocsIndex); the Overview,
 * /docs/overview, is the guide's README, the page an agent starts from.
 */

import type { FrameworkData } from "@/lib/docs/framework-content";
import type { CatalogTool, DocsSetup } from "@/lib/docs/tools";
import { headingId, parseDoc } from "@/lib/docs/guide-parse";
import { cn } from "@/lib/utils";
import { DocCrumbs } from "./doc-crumbs";
import { DocsIndex } from "./docs-index";
import { MarkdownDoc } from "./markdown-doc";
import { GROUPS, HOME, docBySlug } from "./registry";
import { DocsDataProvider } from "./tool-catalog";

export { HOME, OVERVIEW } from "./registry";

export function DocsHub({
  slug,
  tools,
  setups,
  guide,
  framework,
}: {
  slug: string;
  tools: readonly CatalogTool[];
  setups: readonly DocsSetup[];
  guide: Readonly<Record<string, string>>;
  framework: FrameworkData;
}) {
  const meta = docBySlug(slug);
  const home = slug === HOME;
  const source = home ? "" : guide[slug] ?? "";
  const sections = parseDoc(source).parts.flatMap((p) => (p.kind === "section" && p.title ? [p.title] : []));

  return (
    <DocsDataProvider tools={tools} setups={setups} guide={guide} framework={framework}>
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-32 pt-6 sm:px-6 lg:gap-12 xl:grid-cols-[minmax(0,1fr)_12rem]">
        <article className={cn("flex min-w-0 flex-col gap-8", !sections.length && "xl:col-span-2")}>
          {home ? (
            <DocsIndex guide={guide} />
          ) : (
            <>
              <DocCrumbs group={meta ? GROUPS.find((g) => g.group === meta.group)?.label ?? meta.group : "Start here"} title={meta?.title ?? "Overview"} groupHref="/docs" />
              <MarkdownDoc source={source} />
            </>
          )}
        </article>

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
