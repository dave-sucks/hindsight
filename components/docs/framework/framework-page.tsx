"use client";

/**
 * /docs/framework — how an agent is put together: one request taken apart,
 * every door opened up, the read zoomed in, and the instructions that travel
 * with a stock. The numbers come measured from the server (lib/docs/framework.ts).
 */

import type { ReactNode } from "react";
import { ArrowRight, BookOpen, FileSearch, Layers, ListChecks, Wrench } from "lucide-react";
import type { FrameworkData } from "@/lib/docs/framework-content";
import { DocsNav } from "../docs-nav";
import { Eyebrow, Mono, TwoTone } from "../primitives";
import { DoorInspector } from "./door-inspector";
import { ReadDemo } from "./read-demo";
import { RequestGrid } from "./request-grid";
import { SituationsGrid } from "./situations-grid";

const DOORS = ["Your chat", "A clock", "A trigger fires", "You start discovery", "Another agent asks"];
const SHARED = ["House rules", "Analyst brief", "The read", "The save"];
const OUT = [
  { t: "Edits", b: "Theses, floors and plans. Each one a line in Activity." },
  { t: "Proposals", b: "Buys, sales, adds and trims, in your queue the moment they're made." },
];

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
            rest="An agent is a job and a list of tools, started by a door. What every agent shares is written once, so they all behave the same."
          />
        </div>

        {/* Doors in, the agent defined once, what comes out. */}
        <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)_auto_minmax(0,1fr)]">
          <Column label="A door starts it">
            {DOORS.map((d) => (
              <span key={d} className="rounded-lg border bg-background px-3 py-2 text-sm text-foreground">
                {d}
              </span>
            ))}
          </Column>
          <Arrow />
          <Column label="The agent, defined once" strong>
            <span className="rounded-lg border bg-background px-3 py-2 text-sm text-foreground">Its job prompt, one per door</span>
            <span className="rounded-lg border bg-background px-3 py-2 text-sm text-foreground">Its tools, a list per door</span>
            <span className="pt-2 text-xs text-muted-foreground">Shared by every agent</span>
            <span className="grid grid-cols-2 gap-1.5">
              {SHARED.map((s) => (
                <span key={s} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-foreground">
                  {s}
                </span>
              ))}
            </span>
          </Column>
          <Arrow />
          <Column label="What comes out">
            {OUT.map((o) => (
              <span key={o.t} className="flex flex-col gap-0.5 rounded-lg border bg-background px-3 py-2">
                <span className="text-sm font-medium text-foreground">{o.t}</span>
                <span className="text-sm text-muted-foreground">{o.b}</span>
              </span>
            ))}
            <span className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Nothing trades until you approve.</span>
          </Column>
        </div>
      </section>

      <Block
        eyebrow="One request"
        lead="What the model is sent, piece by piece."
        rest="An agent gets its whole prompt again on every request, and a morning run makes about fifteen. So the size of one request is the cost of the run, and what's in it is what the agent knows."
      >
        <RequestGrid data={data} />
      </Block>

      <Block
        eyebrow="The doors"
        lead="Every door, opened up."
        rest="Same agent, different job. Pick a door to see its model, what it carries, and the tools it can reach."
      >
        <DoorInspector data={data} />
      </Block>

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
        rest="Sixteen situations a stock can be in, worked out from its facts on every read. What an agent should do in each lives in one table, and only the ones that are up get sent."
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

function Column({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-2xl border bg-muted/40 p-4"
      style={strong ? { backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" } : undefined}
    >
      <p className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <span className="grid place-items-center text-muted-foreground" aria-hidden>
      <ArrowRight className="size-4 rotate-90 lg:rotate-0" />
    </span>
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
