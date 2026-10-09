"use client";

/**
 * /docs — the home page: the loop as a canvas, the order to meet the product
 * in, the agents, the concepts, and every tool. Each card opens its page in a
 * sheet; `?doc=<slug>` deep-links one.
 */

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Search } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { CatalogTool, DocsSetup } from "@/lib/docs/tools";
import { cn } from "@/lib/utils";
import { AgentAsset } from "./agent-assets";
import { LoopCanvas } from "./loop-canvas";
import { Eyebrow, TwoTone } from "./primitives";
import { DOCS, GET_STARTED, docBySlug, type DocSlug } from "./registry";
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-24 px-4 pb-32 pt-10 sm:px-6 lg:pt-16">
        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
          <LoopCanvas onOpen={setDoc} />
        </section>

        <section className="flex flex-col gap-8" aria-labelledby="gs-h">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>Get started</Eyebrow>
            <TwoTone id="gs-h" lead="From an empty desk to a guarded book." rest="Five steps, in the order you'll meet them." />
          </div>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {GET_STARTED.map((s, i) => (
              <li key={s.slug} className="grid">
                <button type="button" onClick={() => setDoc(s.slug)} className="group grid w-full text-left">
                  <Card>
                    <CardHeader>
                      <span className="text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                      <CardTitle>{s.title}</CardTitle>
                      <CardDescription>{s.blurb}</CardDescription>
                    </CardHeader>
                  </Card>
                </button>
              </li>
            ))}
          </ol>
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
        <SheetContent side="right" size="xl" floating>
          {open ? (
            <div className="flex flex-col gap-10 px-6 pb-16 pt-6 sm:px-10">
              <div className="flex items-center gap-2 pr-10 text-sm text-muted-foreground">
                <SheetTitle>{open.title}</SheetTitle>
                <span aria-hidden>·</span>
                <span>{open.group}</span>
                <Link href={`/docs/${open.slug}`} className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
                  Open as page
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
              <open.Content />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </DocsDataProvider>
  );
}
