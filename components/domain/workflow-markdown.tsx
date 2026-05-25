"use client";

/**
 * WorkflowMarkdown — renders agent-workflow doc content from a markdown
 * string. Reuses the codebase's compact markdown styling for headings /
 * lists / code blocks, and adds custom link-prefix dispatch for inline
 * cross-references:
 *
 *   [label](agent:id)        → <AgentPill>
 *   [label](tool:name)       → <ToolPill>  (optional ?provider=foo on href)
 *   [label](entity:name)     → <EntityPill>
 *   [label](https://…)       → normal external link (new tab)
 *
 * Authors write each agent's doc in
 *   app/(root)/agent-workflow/content/<id>.md
 * and the rendered output appears inside the per-agent sheet on
 * /agent-workflow.
 */

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import {
  AgentPill,
  ToolPill,
  EntityPill,
  DataFlowLine,
  parseFlowLine,
} from "@/components/domain/workflow-pills";

// Parse `tool:name?provider=finnhub` into { name, provider }.
function parseToolHref(href: string): { name: string; provider?: string } {
  const raw = href.slice("tool:".length);
  const [name, query] = raw.split("?");
  if (!query) return { name };
  const params = new URLSearchParams(query);
  return { name, provider: params.get("provider") ?? undefined };
}

const components: Components = {
  // Custom link dispatch — the load-bearing piece. Each href prefix maps
  // to a pill component; anything else (https://, mailto:, relative paths)
  // falls through to a normal external link.
  a: ({ href, children }) => {
    const text =
      typeof children === "string"
        ? children
        : Array.isArray(children)
          ? children.join("")
          : String(children ?? "");

    if (!href) return <span>{children}</span>;

    if (href.startsWith("agent:")) {
      return <AgentPill teamId={href.slice("agent:".length)} label={text} />;
    }
    if (href.startsWith("tool:")) {
      const { name, provider } = parseToolHref(href);
      return <ToolPill name={name} provider={provider} label={text} />;
    }
    if (href.startsWith("entity:")) {
      return <EntityPill name={href.slice("entity:".length)} label={text} />;
    }

    // Default: external link with new-tab + tiny chevron affordance.
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground transition-colors"
      >
        {children}
        <ExternalLink className="h-3 w-3 text-muted-foreground" />
      </a>
    );
  },

  // Compact heading hierarchy tuned for sheet rendering — denser than the
  // prose variant in components/ui/markdown.tsx.
  h1: ({ children }) => (
    <h2 className="mt-6 mb-2 text-base font-semibold first:mt-0">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-5 mb-1.5 text-sm font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-sm leading-relaxed text-muted-foreground last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 ml-4 list-disc space-y-1 text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground/50 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground/50 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  // Inline code (`text`) — small pill style.
  code: ({ children, className }) => {
    // Fenced code blocks pass a `language-xxx` className; we let the
    // `pre` override below own those (including the reads/writes
    // data-flow fences). This branch is just inline code.
    if (className?.startsWith("language-")) {
      // Pass through unchanged so <pre> can read className/children.
      return <code className={className}>{children}</code>;
    }
    return (
      // eslint-disable-next-line no-restricted-syntax -- subtle inline-code treatment — the design rule's "dedicated component" carve-out covers this
      <code className="rounded bg-muted/40 px-1 py-0.5 text-xs font-mono text-foreground/90">
        {children}
      </code>
    );
  },
  // Fenced code blocks. We intercept the `reads` / `writes` languages to
  // render data-flow rows (visual indicators of which tools a step uses
  // and the conditions under which it uses them). Other languages fall
  // through to a plain monospace block.
  pre: ({ children }) => {
    // The single child is a <code> element with className="language-xxx"
    // (or no className for an indented code block, which we don't use).
    // Peek at it to decide whether to specialize.
    const child = Array.isArray(children) ? children[0] : children;
    const codeProps =
      child &&
      typeof child === "object" &&
      "props" in child &&
      (child.props as { className?: string; children?: React.ReactNode });
    const className = codeProps && codeProps.className;
    const match = /language-(\w+)/.exec(className ?? "");
    const lang = match?.[1];

    if (lang === "reads" || lang === "writes") {
      const direction: "read" | "write" = lang === "reads" ? "read" : "write";
      const body = String(codeProps?.children ?? "").replace(/\n$/, "");
      const lines = body.split("\n").map(parseFlowLine).filter(Boolean);
      return (
        <div className="my-3">
          {lines.map((parsed, i) =>
            parsed ? (
              <DataFlowLine
                key={i}
                direction={direction}
                toolName={parsed.toolName}
                provider={parsed.provider}
                condition={parsed.condition}
              />
            ) : null,
          )}
        </div>
      );
    }

    return (
      // eslint-disable-next-line no-restricted-syntax -- code blocks are exactly the case the design rule's "dedicated component" carve-out is for
      <pre className="my-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs font-mono leading-relaxed">
        {children}
      </pre>
    );
  },
  hr: () => <hr className="my-4 border-border/50" />,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
      {children}
    </blockquote>
  ),
};

export function WorkflowMarkdown({ children }: { children: string }) {
  return (
    <div className="text-foreground/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
