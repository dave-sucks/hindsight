"use client";

/** /docs/[slug] — one page full width, with the way back to the docs home. */

import type { CatalogTool, DocsSetup } from "@/lib/docs/tools";
import { DocCrumbs } from "./doc-crumbs";
import { docBySlug } from "./registry";
import { GuideDoc } from "./markdown-doc";
import { DocsDataProvider } from "./tool-catalog";

export function DocPage({ slug, tools, setups, guide }: { slug: string; tools: readonly CatalogTool[]; setups: readonly DocsSetup[]; guide: Readonly<Record<string, string>> }) {
  const doc = docBySlug(slug);
  if (!doc) return null;
  return (
    <DocsDataProvider tools={tools} setups={setups} guide={guide}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-32 pt-10 sm:px-6 lg:pt-14">
        <DocCrumbs group={doc.group} title={doc.title} groupHref="/docs" />
        <GuideDoc slug={doc.slug} />
      </div>
    </DocsDataProvider>
  );
}
