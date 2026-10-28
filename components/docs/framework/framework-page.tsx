"use client";

/**
 * /how-it-works/framework — how an agent is put together: one request taken apart
 * (the same parts for every agent), the read zoomed in, and the instructions that travel
 * with a stock. The numbers come measured from the server (lib/docs/framework.ts).
 */

import type { ReactNode } from "react";
import { BookOpen, FileSearch, Layers, ListChecks, Wrench } from "lucide-react";
import type { FrameworkData } from "@/lib/docs/framework-content";
import { DocsNav } from "../docs-nav";
import { Eyebrow, Mono, TwoTone } from "../primitives";
import { ReadDemo } from "./read-demo";
import { RequestGrid } from "./request-grid";
import { SituationsGrid } from "./situations-grid";

export function FrameworkPage({ data }: { data: FrameworkData }) {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const situation = data.situations.find((s) => s.code === "BUY_ARRIVES");

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-24 px-4 pb-32 pt-6 sm:px-6 lg:pt-10">
      <section className="flex flex-col gap-10">
        <div className="flex flex-col gap-5">
          <DocsNav />
          <Eyebrow className="pt-6">The Framework</Eyebrow>
          <TwoTone
            as="h1"
            size="hero"
            lead="One agent, many doors."
            rest="Every agent is sent the same parts on every request: its job, the house rules, the analyst, its tools and the read. Only the sizes change."
          />
        </div>

        <RequestGrid data={data} />
      </section>

      <Block
        id="read"
        eyebrow="The read"
        lead="Each stock at the size today needs."
        rest="Every agent asks one tool for its stocks. Code decides how much of each thesis to send: one line when nothing changed, more when something did, everything when asked by name."
      >
        <ReadDemo situation={situation} />
      </Block>

      <Block
        id="situations"
        eyebrow="Situations"
        lead="Instructions travel with the stock they're about."
        rest="Seventeen situations a stock can be in, worked out from its facts on every read (one, an Auto trade to write up, comes from the trade). What an agent should do in each lives in one table, and only the ones that are up get sent."
      >
        <SituationsGrid situations={data.situations} />
      </Block>

      <Block
        eyebrow="On demand"
        lead="Pulled in only when needed."
        rest="Pieces that sit outside every request and are added when a stock or a question calls for them."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Shelf icon={Layers} title="Situation guidance" size={`${fmt(Math.min(...data.situations.map((s) => s.chars)))}–${fmt(Math.max(...data.situations.map((s) => s.chars)))} each`}>
            The text for a flag that&apos;s up, attached once to the read.
          </Shelf>
          <Shelf icon={ListChecks} title="Setup lines" size="a few lines">
            How the stock&apos;s setup fails and how to manage it, on the rows where the decision turns on it.
          </Shelf>
          <Shelf icon={BookOpen} title="A full row, by name" size="~20,000">
            The whole thesis with its research, when an agent asks for one stock.
          </Shelf>
          <Shelf icon={FileSearch} title="The writer's report" size="one stock">
            The morning run or the chat can start the writer on a stock and read what it wrote.
          </Shelf>
          <Shelf icon={Wrench} title="Data on request" size="per call">
            News, earnings, filings, charts and the web, pulled with a tool. The result joins the conversation.
          </Shelf>
        </div>
      </Block>

      <footer className="flex flex-wrap justify-between gap-2 border-t pt-6 text-xs text-muted-foreground">
        <span>Prompts, tool menus, models and the situation texts are measured from the code on this deploy.</span>
        <span>The real request is a Secular Compounder morning, from the Agent Rebuild Roadmap.</span>
      </footer>
    </div>
  );
}

function Block({ id, eyebrow, lead, rest, children }: { id?: string; eyebrow: string; lead: string; rest: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-8">
      <div className="flex flex-col gap-2.5">
        <Eyebrow>{eyebrow}</Eyebrow>
        <TwoTone lead={lead} rest={rest} />
      </div>
      {children}
    </section>
  );
}

function Shelf({ icon: Icon, title, size, children }: { icon: typeof Layers; title: string; size: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-dashed bg-card p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{title}</span>
        <Mono className="ml-auto text-xs text-muted-foreground">{size}</Mono>
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
