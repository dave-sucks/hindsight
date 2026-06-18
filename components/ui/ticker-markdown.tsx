"use client";

/**
 * Markdown renderer with inline $TICKER chip support.
 * Wraps react-markdown and processes text nodes to replace $AAPL patterns
 * with interactive TickerChip components (live price + hover card).
 */

import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  TickerChip,
  parseTickerMentions,
  usePrefetchTickers,
} from "@/components/chat/TickerChip";
import { Fragment, type ReactNode, Children, isValidElement, cloneElement, useMemo } from "react";

// ── Ticker processing ─────────────────────────────────────────────────────────

function processTextWithTickers(text: string, keyPrefix: string): ReactNode[] {
  const segments = parseTickerMentions(text);
  if (segments.length === 1 && segments[0].type === "text") {
    return [text];
  }
  return segments.map((seg, i) =>
    seg.type === "text" ? (
      <Fragment key={`${keyPrefix}-${i}`}>{seg.value}</Fragment>
    ) : (
      <TickerChip key={`${keyPrefix}-tk${i}`} symbol={seg.symbol} />
    )
  );
}

function processChildrenWithTickers(children: ReactNode): ReactNode {
  return Children.map(children, (child, idx) => {
    if (typeof child === "string") {
      const nodes = processTextWithTickers(child, `n${idx}`);
      if (nodes.length === 1 && typeof nodes[0] === "string") return child;
      return nodes;
    }
    if (isValidElement(child)) {
      const props = child.props as Record<string, unknown>;
      if (props.children) {
        return cloneElement(
          child,
          undefined,
          processChildrenWithTickers(props.children as ReactNode)
        );
      }
    }
    return child;
  });
}

// ── Ticker-aware markdown component wrappers ────────────────────────────────

function TickerP({ children }: { children?: ReactNode }) {
  return (
    <p className="my-3 leading-relaxed first:mt-0 last:mb-0">
      {processChildrenWithTickers(children)}
    </p>
  );
}

function TickerLi({ children }: { children?: ReactNode }) {
  return (
    <li className="leading-relaxed">
      {processChildrenWithTickers(children)}
    </li>
  );
}

function TickerBlockquote({ children }: { children?: ReactNode }) {
  return (
    <blockquote className="my-4 border-l-2 border-muted-foreground/30 pl-4 text-muted-foreground italic">
      {processChildrenWithTickers(children)}
    </blockquote>
  );
}

// ── Component maps ──────────────────────────────────────────────────────────

const tickerProseComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 mt-8 scroll-m-20 text-2xl font-bold tracking-tight first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-6 scroll-m-20 text-lg font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 scroll-m-20 text-base font-semibold first:mt-0">
      {children}
    </h3>
  ),
  p: TickerP,
  ul: ({ children }) => (
    <ul className="my-3 ml-6 list-disc marker:text-muted-foreground [&>li]:mt-1.5">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 ml-6 list-decimal marker:text-muted-foreground [&>li]:mt-1.5">
      {children}
    </ol>
  ),
  li: TickerLi,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: TickerBlockquote,
  hr: () => <hr className="my-6 border-muted-foreground/20" />,
  code: ({ children }) => (
    <code className="rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-3 py-2 text-left font-semibold bg-muted/50">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-2">{children}</td>
  ),
};

// ── Extract tickers from markdown for batch prefetch ─────────────────────────

const TICKER_RE = /(?<!\w)\$([A-Z]{1,5})(?!\w)/g;

function extractTickers(text: string): string[] {
  const matches = text.matchAll(TICKER_RE);
  return [...new Set([...matches].map((m) => m[1]))];
}

// ── Public component ────────────────────────────────────────────────────────

interface TickerMarkdownProps {
  children: string;
  className?: string;
}

export function TickerMarkdown({ children, className }: TickerMarkdownProps) {
  const tickers = useMemo(() => extractTickers(children), [children]);
  usePrefetchTickers(tickers);

  return (
    <div className={cn("max-w-none text-sm text-foreground/90", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={tickerProseComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// ── Digest reference-token rendering ─────────────────────────────────────────
// The Daily Portfolio Digest narrative uses markdown links with a typed href
// scheme to embed clickable references inline in prose:
//   [MU](thesis:THESIS_ID)            — a ticker → opens the ticker's stock/thesis
//   [Momentum Breakout](analyst:ID)   — an analyst → /analysts/[id]
//   [tactical 18:46](run:RUN_ID)      — a run → /runs/[id]
// Any other scheme degrades to a plain underlined link, and a malformed token
// degrades to readable text, so new reference kinds keep working for free.

// The digest's typed reference schemes. react-markdown's default urlTransform
// sanitizes any href whose protocol isn't in its safe list (http/https/mailto/
// tel/relative), which silently strips these custom schemes down to an empty
// href — so the DigestAnchor handler would see no scheme and the tokens would
// render as inert text. We preserve exactly these schemes and defer to the
// default transform (XSS protection against javascript: etc.) for everything
// else.
const DIGEST_REF_SCHEMES = new Set(["thesis", "analyst", "run"]);

function digestUrlTransform(url: string): string {
  const idx = url.indexOf(":");
  if (idx > 0 && DIGEST_REF_SCHEMES.has(url.slice(0, idx).toLowerCase())) {
    return url;
  }
  return defaultUrlTransform(url);
}

/** Split a typed href like "thesis:abc123" into its scheme + id. */
function parseRefHref(href: string): { scheme: string; id: string } | null {
  const idx = href.indexOf(":");
  if (idx <= 0) return null;
  const scheme = href.slice(0, idx).trim().toLowerCase();
  const id = href.slice(idx + 1).trim();
  if (!id) return null;
  return { scheme, id };
}

/** Underlined inline link used for analyst/run/fallback reference tokens. */
function RefLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="underline underline-offset-2 decoration-muted-foreground/40 hover:decoration-foreground"
    >
      {children}
    </Link>
  );
}

/**
 * A ticker reference token. Renders the existing prose ticker chip (live price +
 * hover card) wrapped in a link to the canonical stock page (`/stocks/[ticker]`,
 * the same target trade rows and the thesis sheet use), so clicking opens that
 * ticker's thesis/stock detail. Falls back to a plain underlined label if the
 * label isn't a clean ticker symbol.
 */
function TickerRefLink({ label }: { label: string }) {
  const symbol = label.trim().toUpperCase();
  const isTicker = /^[A-Z]{1,5}$/.test(symbol);
  if (!isTicker) {
    return (
      <RefLink href={`/stocks/${encodeURIComponent(label.trim())}`}>
        {label}
      </RefLink>
    );
  }
  return (
    <Link href={`/stocks/${symbol}`} className="no-underline">
      <TickerChip symbol={symbol} />
    </Link>
  );
}

/** Renders a digest markdown link, dispatching on the typed href scheme. */
function DigestAnchor({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const parsed = href ? parseRefHref(href) : null;

  // No typed scheme → ordinary link (or just text if no href at all).
  if (!parsed) {
    if (!href) return <>{children}</>;
    return <RefLink href={href}>{children}</RefLink>;
  }

  const { scheme, id } = parsed;
  const label = childrenToText(children);

  switch (scheme) {
    case "thesis":
      // A ticker token. The label is the ticker symbol; the id is the thesis.
      // We open the canonical stock page for that ticker.
      return label ? <TickerRefLink label={label} /> : <>{children}</>;
    case "analyst":
      return <RefLink href={`/analysts/${id}`}>{children}</RefLink>;
    case "run":
      return <RefLink href={`/runs/${id}`}>{children}</RefLink>;
    default:
      // Unknown scheme → degrade to a plain underlined link to the raw href.
      return <RefLink href={href!}>{children}</RefLink>;
  }
}

/** Flatten simple link children to a plain string (for the ticker symbol). */
function childrenToText(children: ReactNode): string {
  let out = "";
  Children.forEach(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      out += String(child);
    } else if (isValidElement(child)) {
      out += childrenToText((child.props as { children?: ReactNode }).children);
    }
  });
  return out.trim();
}

// Digest component map — same prose styling as ticker markdown, plus the typed
// `a` handler. Reuses every ticker-aware wrapper so cashtags/$TICKER still work.
const digestProseComponents: Components = {
  ...tickerProseComponents,
  a: DigestAnchor,
};

export function DigestMarkdown({ children, className }: TickerMarkdownProps) {
  const tickers = useMemo(() => extractTickers(children), [children]);
  usePrefetchTickers(tickers);

  return (
    <div className={cn("max-w-none text-sm text-foreground/90", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={digestProseComponents}
        urlTransform={digestUrlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
