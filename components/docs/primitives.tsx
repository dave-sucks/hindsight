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
import { ChevronDown, Code2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}>{children}</p>;
}

const TWO_TONE_SIZE = {
  hero: "text-3xl leading-[1.1] sm:text-4xl lg:text-5xl max-w-[26ch]",
  page: "text-3xl leading-[1.1] sm:text-4xl max-w-[24ch]",
  section: "text-2xl leading-tight sm:text-3xl max-w-[28ch]",
  sub: "text-xl leading-snug max-w-[34ch]",
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
  return <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{children}</p>;
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

/** The part written for agents and builders: collapsed by default. */
export function TechDetails({ rows }: { rows: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <Collapsible>
      <div className="rounded-xl border bg-card">
        <CollapsibleTrigger className="group/tech flex w-full items-center gap-2.5 px-4 py-3.5 text-left text-sm font-medium focus-visible:outline-none">
          <Code2 className="size-4 text-muted-foreground" />
          Technical details
          <span className="ml-auto text-xs font-normal text-muted-foreground">for agents and builders</span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[panel-open]/tech:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="px-4 pb-3">
            {rows.map((r) => (
              <div key={r.label} className="grid gap-1 border-t py-3 text-sm sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{r.value}</dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** The doc's own opening: eyebrow, headline, then whatever comes first. */
export function DocHeader({ eyebrow, lead, rest }: { eyebrow: string; lead: ReactNode; rest: ReactNode }) {
  return (
    <header className="flex flex-col gap-3">
      <Eyebrow>{eyebrow}</Eyebrow>
      <TwoTone lead={lead} rest={rest} size="page" as="h2" />
    </header>
  );
}

/** The vertical rhythm of a doc body. */
export function DocBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-14">{children}</div>;
}
