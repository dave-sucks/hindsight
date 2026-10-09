"use client";

/**
 * /docs — the home page: the loop as a canvas, the order to meet the product
 * in, the agents, the concepts, and every tool. Each card opens its page in a
 * sheet; `?doc=<slug>` deep-links one.
 */

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Maximize2, Search, X } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import type { CatalogTool, DocsSetup } from "@/lib/docs/tools";
import { cn } from "@/lib/utils";
import { AgentAsset } from "./agent-assets";
import { LoopCanvas } from "./loop-canvas";
import { Eyebrow, TwoTone } from "./primitives";
import { DocCrumbs } from "./doc-crumbs";
import { DocsNav } from "./docs-nav";
import { DOCS, docBySlug, type DocSlug } from "./registry";
import { StockStory } from "./stock-story";
import { DocsDataProvider, ToolCatalog } from "./tool-catalog";

export function DocsHome({ tools, setups }: { tools: readonly CatalogTool[]; setups: readonly DocsSetup[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openSlug = params.get("doc");
  const open = openSlug ? docBySlug(openSlug) : undefined;
  const search = useRef<HTMLInputElement>(null);

  const setDoc = useCallback(
    (slug: DocSlug | null) => router.replace(slug ? `${pathname}?doc=${slug}` : pathname, { scroll: false }),
    [router, pathname],
  );

  const focusSearch = useCallback(() => {
    document.getElementById("tools")?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => search.current?.focus({ preventScroll: true }), 350);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setDoc(null);
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch, setDoc]);

  const agents = DOCS.filter((d) => d.group === "Agents");
  const concepts = DOCS.filter((d) => d.group === "Concepts");

  return (
    <DocsDataProvider tools={tools} setups={setups}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-24 px-4 pb-32 pt-6 sm:px-6 lg:pt-10">
        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-5">
            <DocsNav />
            <div className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <Eyebrow>How Hindsight works</Eyebrow>
              <button
                type="button"
                onClick={focusSearch}
                className="inline-flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
              >
                <Search className="size-4" />
                Search tools
                <Kbd>/</Kbd>
              </button>
            </div>
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

        <section className="flex flex-col gap-8" aria-labelledby="agents-h">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>The agents</Eyebrow>
            <TwoTone id="agents-h" lead="Five agents, one desk." rest="Each wakes for its own reason and uses its own tools. Here is what each one looks like at work." />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            {agents.map((d, i) => (
              <div
                key={d.slug}
                className={cn(
                  "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card text-left transition hover:-translate-y-0.5 hover:border-foreground/20 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring",
                  i < 2 ? "lg:col-span-3" : "lg:col-span-2",
                )}
              >
                {/* The whole card opens the page. A layered button, so the
                    chat picture's own buttons aren't nested inside it. */}
                <button type="button" onClick={() => setDoc(d.slug)} className="absolute inset-0 z-10 focus-visible:outline-none" aria-label={`Open ${d.title}`} />
                <div
                  className="relative h-56 overflow-hidden border-b bg-muted/40 px-5 pt-5"
                  style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
                >
                  <div className="pointer-events-none">
                    <AgentAsset slug={d.slug} />
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-muted/80 to-transparent" />
                </div>
                <div className="flex flex-col gap-1 p-5">
                  <span className="flex items-center gap-2 text-base font-medium text-foreground">
                    <d.icon className="size-4 text-muted-foreground" />
                    {d.title}
                    <ArrowUpRight className="ml-auto size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  </span>
                  <span className="text-sm text-muted-foreground">{d.blurb}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-8" aria-labelledby="concepts-h">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>Concepts</Eyebrow>
            <TwoTone id="concepts-h" lead="The few ideas everything is built on." rest="Learn these and every screen makes sense." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {concepts.map((d) => (
              <button key={d.slug} type="button" onClick={() => setDoc(d.slug)} className="group grid w-full text-left">
                <Card>
                  <CardHeader>
                    <span className="mb-2 grid size-8 place-items-center rounded-lg border bg-muted text-muted-foreground transition group-hover:text-foreground">
                      <d.icon className="size-4" />
                    </span>
                    <CardTitle>{d.title}</CardTitle>
                    <CardDescription>{d.blurb}</CardDescription>
                  </CardHeader>
                </Card>
              </button>
            ))}
          </div>
        </section>

        <section id="tools" className="flex scroll-mt-20 flex-col gap-8" aria-labelledby="tools-h">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>Tools</Eyebrow>
            <TwoTone id="tools-h" lead="Everything an analyst can reach." rest="Market data, filings, the web and your book, and which agent can use what." />
          </div>
          <ToolCatalog searchRef={search} />
        </section>

        <footer className="flex flex-wrap justify-between gap-2 border-t pt-6 text-xs text-muted-foreground">
          <span>Which agent has which tool is read from the code on every load.</span>
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
