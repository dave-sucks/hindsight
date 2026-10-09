"use client";

/** /docs/[slug] — one page full width, with the way back to the docs home. */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { CatalogTool, DocsSetup } from "@/lib/docs/tools";
import { docBySlug } from "./registry";
import { DocsDataProvider } from "./tool-catalog";

export function DocPage({ slug, tools, setups }: { slug: string; tools: readonly CatalogTool[]; setups: readonly DocsSetup[] }) {
  const doc = docBySlug(slug);
  if (!doc) return null;
  return (
    <DocsDataProvider tools={tools} setups={setups}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 pb-32 pt-10 sm:px-6 lg:pt-14">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="Breadcrumb">
          <Link href="/docs" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            Docs
          </Link>
          <span aria-hidden>/</span>
          <span>{doc.group}</span>
          <span aria-hidden>/</span>
          <span className="text-foreground">{doc.title}</span>
        </nav>
        <doc.Content />
      </div>
    </DocsDataProvider>
  );
}
