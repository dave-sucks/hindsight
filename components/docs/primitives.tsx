"use client";

/**
 * The building blocks every /docs page is made of. Plain elements styled
 * with the theme's tokens; ShadCN pieces are used as-is (Collapsible here).
 *
 *   Eyebrow · TwoTone (the bold-then-muted headline) · Stage (the dotted
 *   panel a product moment sits on) · Trio · Steps · Anatomy · Section ·
 *   TechDetails · Code
 */

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}>{children}</p>;
}

const TWO_TONE_SIZE = {
  hero: "text-2xl leading-tight sm:text-3xl lg:text-4xl lg:max-w-[70%]",
  page: "text-2xl leading-tight sm:text-3xl lg:max-w-[70%]",
  section: "text-xl leading-snug sm:text-2xl lg:max-w-[70%]",
  sub: "text-lg leading-snug lg:max-w-[70%]",
  /** The sentence every doc opens with: large, and as wide as the page. */
  intro: "text-xl leading-snug sm:text-2xl",
} as const;

/** A headline in two tones: the claim, then the explanation in muted ink. */
export function TwoTone({
  lead,
  rest,
  size = "section",
  as: As = "h2",
  id,
}: {
  lead: ReactNode;
  rest?: ReactNode;
  size?: keyof typeof TWO_TONE_SIZE;
  as?: "h1" | "h2" | "h3";
  id?: string;
}) {
  return (
    <As id={id} className={cn("font-medium tracking-tight text-balance text-foreground", TWO_TONE_SIZE[size])}>
      {lead}
      {rest ? <span className="text-muted-foreground"> {rest}</span> : null}
    </As>
  );
}

/** The dotted panel a product moment sits on. */
export function Stage({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** A small mono tag in the corner: "Example", "Example run". */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("relative rounded-2xl border bg-muted/40 p-5 sm:p-8", className)}
      style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
    >
      {label ? (
        <span className="absolute right-4 top-3 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      ) : null}
      {children}
    </div>
  );
}

/** Three short claims side by side, split by hairlines. */
export function Trio({ items }: { items: ReadonlyArray<{ title: string; body: ReactNode }> }) {
  return (
    <div className="grid border-t sm:grid-cols-3">
      {items.map((it, i) => (
        <div
          key={it.title}
          className={cn("flex flex-col gap-1.5 pt-5 sm:pr-6", i > 0 && "mt-5 border-t sm:mt-0 sm:border-t-0 sm:border-l sm:pl-6")}
        >
          <p className="text-sm font-medium text-foreground">{it.title}</p>
          <p className="text-sm text-muted-foreground">{it.body}</p>
        </div>
      ))}
    </div>
  );
}

/** A real sequence, left to right: the dots sit on one line. */
export function Steps({ items }: { items: ReadonlyArray<{ title: string; body: ReactNode }> }) {
  return (
    <ol className={cn("grid gap-0", items.length === 4 ? "sm:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-5")}>
      {items.map((it, i) => (
        <li key={it.title} className="relative flex flex-col gap-1.5 border-t border-foreground/15 py-5 sm:pr-5">
          <span className="absolute -top-1 left-0 size-2 rounded-full bg-foreground" aria-hidden />
          <span className="text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
          <span className="text-base font-medium text-foreground">{it.title}</span>
          <span className="text-sm text-muted-foreground">{it.body}</span>
        </li>
      ))}
    </ol>
  );
}

/** A numbered list of parts, in two columns. */
export function Anatomy({ items }: { items: ReadonlyArray<{ title: string; body: ReactNode }> }) {
  return (
    <div className="grid gap-x-8 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={it.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-t py-3.5">
          <span className="pt-0.5 text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
          <span className="text-sm font-medium text-foreground">{it.title}</span>
          <span className="col-start-2 text-sm text-muted-foreground">{it.body}</span>
        </div>
      ))}
    </div>
  );
}

/** A section inside a doc: eyebrow, two-tone headline, then the body. */
export function Section({
  eyebrow,
  lead,
  rest,
  children,
  id,
}: {
  eyebrow: string;
  lead: ReactNode;
  rest?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <TwoTone lead={lead} rest={rest} size="sub" as="h3" />
      </div>
      {children}
    </section>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

/**
 * The one place the docs set text in a monospace face: tool names, endpoints,
 * file paths, the literal text an agent reads. The house lint keeps font-mono
 * out of everything else.
 */
export function Mono({ children, className, as: As = "span" }: { children: ReactNode; className?: string; as?: "span" | "pre" | "code" }) {
  // eslint-disable-next-line no-restricted-syntax -- the dedicated code component the house rule asks for
  return <As className={cn("font-mono", className)}>{children}</As>;
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <Mono as="code" className="rounded border bg-muted px-1 py-px text-xs text-foreground">
      {children}
    </Mono>
  );
}

/** A run of accordions, a line between each and above and below them all. */
export function DocAccordions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y border-y">{children}</div>;
}

/** One plain accordion: a chevron that turns, the title, and ordinary doc content when open. Sits inside DocAccordions. */
export function DocAccordion({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/acc flex w-full items-center gap-2.5 py-3.5 text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/acc:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 pb-5 pl-[1.625rem]">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A small labelled fact: the label in medium foreground, the text muted below it. */
export function DocFact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <div className="leading-6 text-muted-foreground [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** Where a doc's code lives, for whoever works on it: one plain accordion at the foot of the page. */
export function TechDetails({ rows }: { rows: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <DocAccordions>
      <DocAccordion title="Technical details">
        {rows.map((r) => (
          <DocFact key={r.label} label={r.label}>
            {r.value}
          </DocFact>
        ))}
      </DocAccordion>
    </DocAccordions>
  );
}

/**
 * How every doc opens: one large two-tone sentence, the full width of the
 * page, then a short description when the sentence needs one. Where the page
 * sits (Agents / Discovery) is the breadcrumb's job, not the header's.
 */
export function DocHeader({ lead, rest, children }: { lead: ReactNode; rest?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4">
      <TwoTone lead={lead} rest={rest} size="intro" as="h2" />
      {children ? <p className="text-base leading-relaxed text-muted-foreground">{children}</p> : null}
    </header>
  );
}

/** The vertical rhythm of a doc body. */
export function DocBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10">{children}</div>;
}
