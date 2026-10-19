"use client";

/**
 * A guide doc, drawn from its markdown in docs/guide/. The markdown is the
 * one source: agents read the file, this draws the page. Plain markdown
 * covers almost everything; four conventions cover the rest.
 *
 *   # Title, then **Lead sentence.** rest   the page's two-tone header; the next paragraph is its description
 *   ## Heading                              a section
 *   <!-- asset: name arg -->                a picture from ASSETS, on its own line
 *   ```chat … ```                           an example conversation (see parseChat)
 *   <details><summary>…</summary> … </details>   a plain accordion; `#### Label` inside makes a label and its text
 *   ```facts … ```                          an agent's facts, one `label: value` a line, drawn as a metadata strip
 *
 * In text, `[words](slug.md)` links another doc and `code` that names a tool
 * opens that tool. `$CRWD (+6.8%)` inside a chat block is a ticker with its move.
 */

import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import { headingId, parseDoc, type Block } from "@/lib/docs/guide-parse";
import { Tk } from "./chat-mock";
import { ChatExample, DocRef, DocSection, P, ToolRef, Ul } from "./doc-text";
import { ASSETS } from "./doc-assets";
import { Code, DocAccordion, DocAccordions, DocBody, DocFact, DocHeader, Mono } from "./primitives";
import { DOCS, type DocSlug } from "./registry";
import { useDocsTools, useGuideDoc } from "./tool-catalog";

// ── Drawing ────────────────────────────────────────────────────────────────

const SLUGS = new Set<string>(DOCS.map((d) => d.slug));

/** `$CRWD (+6.8%)` → the chat's inline ticker; everything else stays text. */
function withTickers(text: ReactNode): ReactNode {
  if (typeof text !== "string") return text;
  const out: ReactNode[] = [];
  const re = /\$([A-Z]{1,5})(?: \(([+−-]?\d+(?:\.\d+)?)%\))?/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    out.push(<Tk key={m.index} s={m[1]} c={m[2] != null ? Number(m[2].replace("−", "-")) : undefined} />);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function useComponents(chips: boolean): Components {
  const tools = useDocsTools();
  const toolNames = new Set(tools.map((t) => t.code));
  return {
    p: ({ children }) => <P>{children}</P>,
    ul: ({ children }) => <Ul>{children}</Ul>,
    ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm leading-6 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">{children}</ol>,
    h3: ({ children }) => <h4 className="pt-1 text-sm font-medium text-foreground">{children}</h4>,
    table: ({ children }) => (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b bg-muted/40 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</th>,
    td: ({ children }) => <td className="border-b px-3 py-2.5 align-top text-muted-foreground [tr:last-child_&]:border-b-0">{children}</td>,
    blockquote: ({ children }) => <div className="flex flex-col gap-2 border-l-2 pl-4 [&_p]:text-foreground">{children}</div>,
    pre: ({ children }) => (
      <Mono as="pre" className="overflow-x-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
        {children}
      </Mono>
    ),
    code: ({ children, className }) => {
      // A fenced block (it has a language) is drawn by `pre`; inline code is a chip or a name.
      if (className) return <code>{children}</code>;
      const text = String(children);
      return chips && toolNames.has(text) ? <ToolRef name={text} /> : <Code>{text}</Code>;
    },
    a: ({ href, children }) => {
      const doc = href?.match(/(?:^|\/)([\w-]+)\.md$/)?.[1];
      if (doc && SLUGS.has(doc)) return <DocRef slug={doc as DocSlug}>{children}</DocRef>;
      if (href?.startsWith("/")) {
        return (
          <Link href={href} className="font-medium text-foreground underline underline-offset-4">
            {children}
          </Link>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">
          {children}
        </a>
      );
    },
  };
}

/** One paragraph's words, links and code, without its own <p>: the header's description sits in one already. */
function InlineMarkdown({ text }: { text: string }) {
  const components = useComponents(true);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...components, p: ({ children }) => <>{children}</> }}>
      {text}
    </ReactMarkdown>
  );
}

function Markdown({ text, chips = true }: { text: string; chips?: boolean }) {
  const components = useComponents(chips);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "md") return <Markdown text={block.text} />;
  if (block.kind === "facts") return <FactsStrip facts={block.facts} />;
  if (block.kind === "chat") return <ChatExample caption={block.caption} steps={block.steps.map((s) => (s.kind === "text" ? { ...s, text: withTickers(s.text) } : s))} />;
  const Asset = ASSETS[block.name as keyof typeof ASSETS];
  return Asset ? <Asset arg={block.arg} /> : null;
}

/** An agent's facts as a metadata strip: small mono labels over their values. "Tools" jumps to the tool list. */
function FactsStrip({ facts }: { facts: ReadonlyArray<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y py-4 sm:grid-cols-3 lg:grid-cols-5">
      {facts.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1">
          <dt>
            <Mono className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Mono>
          </dt>
          <dd className="text-sm text-foreground">
            {label.toLowerCase() === "tools" ? (
              <a href="#tools" className="underline-offset-4 hover:underline">
                {value}
              </a>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** `#### Label` and the text under it, as a label over muted text. */
function DetailsBody({ body }: { body: string }) {
  if (!/^#### /m.test(body)) return <Markdown text={body} />;
  const facts = body.split(/^#### /m).filter((s) => s.trim());
  return (
    <>
      {facts.map((f) => {
        const [label, ...rest] = f.split("\n");
        return (
          <DocFact key={label} label={label.trim()}>
            <Markdown text={rest.join("\n").trim()} chips={false} />
          </DocFact>
        );
      })}
    </>
  );
}

export function MarkdownDoc({ source }: { source: string }) {
  const doc = parseDoc(source);
  return (
    <DocBody>
      <DocHeader lead={doc.lead} rest={doc.rest}>
        {doc.description ? <InlineMarkdown text={doc.description} /> : null}
      </DocHeader>
      {doc.parts.map((part, k) =>
        part.kind === "details" ? (
          <DocAccordions key={k}>
            <DocAccordion title={part.title}>
              <DetailsBody body={part.body} />
            </DocAccordion>
          </DocAccordions>
        ) : part.title === null ? (
          part.blocks.map((b, j) => <BlockView key={`${k}-${j}`} block={b} />)
        ) : (
          <DocSection key={k} title={part.title} id={headingId(part.title)}>
            {part.blocks.map((b, j) => (
              <BlockView key={j} block={b} />
            ))}
          </DocSection>
        ),
      )}
    </DocBody>
  );
}

/** A guide doc by its slug, from the markdown the server handed down. */
export function GuideDoc({ slug }: { slug: string }) {
  return <MarkdownDoc source={useGuideDoc(slug)} />;
}
