"use client";

/**
 * /docs — the home page: one stock's story through the agents, the workflow
 * canvas, the concepts as cards, and every tool. Each opens its page in a
 * sheet; `?doc=<slug>` deep-links one.
 */

import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Maximize2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import type { CatalogTool, DocsSetup } from "@/lib/docs/tools";
import { ConceptCards } from "./concept-cards";
import { LoopCanvas } from "./loop-canvas";
import { Eyebrow, TwoTone } from "./primitives";
import { DocCrumbs } from "./doc-crumbs";
import { DocsNav } from "./docs-nav";
import { docBySlug, type DocSlug } from "./registry";
import { StockStory } from "./stock-story";
import { DocsDataProvider, ToolCatalog } from "./tool-catalog";

export function DocsHome({ tools, setups }: { tools: readonly CatalogTool[]; setups: readonly DocsSetup[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openSlug = params.get("doc");
  const open = openSlug ? docBySlug(openSlug) : undefined;
  const setDoc = useCallback(
    (slug: DocSlug | null) => router.replace(slug ? `${pathname}?doc=${slug}` : pathname, { scroll: false }),
    [router, pathname],
  );


  return (
    <DocsDataProvider tools={tools} setups={setups}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-24 px-4 pb-32 pt-6 sm:px-6 lg:pt-10">
        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-5">
            <DocsNav />
            <Eyebrow className="pt-6">How Hindsight works</Eyebrow>
            <TwoTone
              as="h1"
              size="hero"
              lead="A research desk that never stops watching."
              rest="Analysts find the stocks, write the case and guard every position. Nothing trades without you."
            />
          </div>
          <StockStory onOpen={setDoc} />
        </section>

        <section className="flex flex-col gap-8" aria-labelledby="flow-h">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>The workflow</Eyebrow>
            <TwoTone id="flow-h" lead="How the pieces connect." rest="Three ways to wake an analyst, one decision, and nothing trades without you. Open any step to read how it works." />
          </div>
          <LoopCanvas onOpen={setDoc} />
        </section>

        <section className="flex flex-col gap-8" aria-labelledby="concepts-h">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>Concepts</Eyebrow>
            <TwoTone id="concepts-h" lead="The few ideas everything is built on." rest="Learn these and every screen makes sense." />
          </div>
          <ConceptCards onOpen={setDoc} />
        </section>

        <section id="tools" className="flex scroll-mt-20 flex-col gap-8" aria-labelledby="tools-h">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>Tools</Eyebrow>
            <TwoTone id="tools-h" lead="Everything an analyst can reach." rest="Market data, filings, the web and your book. Each agent's own list is on its page." />
          </div>
          <ToolCatalog />
        </section>

        <footer className="flex flex-wrap justify-between gap-2 border-t pt-6 text-xs text-muted-foreground">
          <span>Every tool is read from the code on every load.</span>
          <span>
            Each page also lives at its own address, like{" "}
            <Link href="/docs/triggers" className="underline underline-offset-2 hover:text-foreground">
              /docs/triggers
            </Link>
            .
          </span>
        </footer>
      </div>

      <Sheet open={open != null} onOpenChange={(o) => (o ? null : setDoc(null))}>
        <SheetContent side="right" size="xl" floating showCloseButton={false} aria-label={open?.title}>
          {open ? (
            <div className="flex flex-col">
              {/* One row: where the page sits, then expand and close, the way Notion's peek does it. */}
              <div className="flex items-center gap-2 py-3 pl-6 pr-3 sm:pl-10">
                <DocCrumbs group={open.group} title={open.title} />
                <span className="ml-auto flex items-center gap-0.5">
                  <Link href={`/docs/${open.slug}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Open as page" title="Open as page">
                    <Maximize2 />
                  </Link>
                  <SheetClose render={<Button variant="ghost" size="icon-sm" />}>
                    <X />
                    <span className="sr-only">Close</span>
                  </SheetClose>
                </span>
              </div>
              <div className="flex flex-col px-6 pb-16 pt-6 sm:px-10">
                <open.Content />
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </DocsDataProvider>
  );
}
