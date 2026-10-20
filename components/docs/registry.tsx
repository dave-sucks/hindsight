/**
 * Every page of the docs: its address, its name and its group in the docs
 * sidebar. What a page says is its markdown, docs/guide/<folder>/<slug>.md.
 * /docs/[slug] draws it in the docs hub; /how-it-works opens it in a sheet.
 */

import {
  BookOpen,
  CheckCircle2,
  FileText,
  Flag,
  Layers,
  MessageCircle,
  PenLine,
  Search,
  Sun,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type DocSlug =
  | "discovery"
  | "writer"
  | "morning-runs"
  | "trigger-runs"
  | "chat"
  | "analyst-builder"
  | "analysts"
  | "theses"
  | "triggers"
  | "situations"
  | "approvals"
  | "architecture"
  | "glossary"
  | "situations-library"
  | "trigger-measures"
  | "setups"
  | "saving-a-thesis"
  | "sizing-and-limits"
  | "proposal-to-fill"
  | "trigger-fire-to-run";

export interface DocMeta {
  slug: DocSlug;
  title: string;
  group: "Overview" | "Agents" | "Concepts" | "Deep dives" | "Reference";
  blurb: string;
  icon: LucideIcon;
}

export const DOCS: readonly DocMeta[] = [
  { slug: "discovery", title: "Discovery", group: "Agents", icon: Search, blurb: "Screens earnings, movers and the web for stocks that fit an analyst, and sends the best to the Writer." },
  { slug: "writer", title: "The Writer", group: "Agents", icon: PenLine, blurb: "Researches one stock in depth and writes its thesis, plan and all." },
  { slug: "morning-runs", title: "Morning runs", group: "Agents", icon: Sun, blurb: "Every weekday morning, each analyst reviews its whole book." },
  { slug: "trigger-runs", title: "Trigger runs", group: "Agents", icon: Zap, blurb: "A trigger fires and the analyst looks at that one stock within minutes." },
  { slug: "chat", title: "Chat", group: "Agents", icon: MessageCircle, blurb: "Talk to one analyst, or to the whole account." },
  { slug: "analyst-builder", title: "Analyst builder", group: "Agents", icon: UserRound, blurb: "Interviews you and proposes a whole analyst, checked against today's market." },
  { slug: "theses", title: "Theses", group: "Concepts", icon: FileText, blurb: "A belief we can be wrong about, and the plan that acts on it." },
  { slug: "triggers", title: "Triggers", group: "Concepts", icon: Zap, blurb: "One sentence each: sell below, add above, review every 30 days." },
  { slug: "analysts", title: "Analysts", group: "Concepts", icon: UserRound, blurb: "A trading style with its own universe, sizing and sell rules." },
  { slug: "situations", title: "Situations", group: "Concepts", icon: Flag, blurb: "The sixteen reasons a stock needs an answer today." },
  { slug: "approvals", title: "Approvals", group: "Concepts", icon: CheckCircle2, blurb: "Analysts propose. You approve. Proposals expire after a day." },
  { slug: "architecture", title: "Architecture", group: "Overview", icon: Layers, blurb: "How the pieces fit: data, the record, the clocks, the read, the agents and the gate." },
  { slug: "glossary", title: "Glossary", group: "Overview", icon: BookOpen, blurb: "Every term the app, the docs and the agents use, a sentence each." },
  { slug: "saving-a-thesis", title: "Saving a thesis", group: "Deep dives", icon: PenLine, blurb: "How every agent edit lands or is refused: a save is a patch, one trigger at a time, floors only go up." },
  { slug: "sizing-and-limits", title: "Sizing and limits", group: "Deep dives", icon: Layers, blurb: "How big a trade is: risk to the floor, conviction, the market, the analyst's band and slots." },
  { slug: "proposal-to-fill", title: "From proposal to fill", group: "Deep dives", icon: CheckCircle2, blurb: "A trade's life from the agent's call through approval, the broker and the fill." },
  { slug: "trigger-fire-to-run", title: "From fire to run", group: "Deep dives", icon: Zap, blurb: "The five-minute check, what fires, and where each fire goes." },
  { slug: "situations-library", title: "Situations library", group: "Reference", icon: Flag, blurb: "All sixteen situations: each code, what it means and the exact text an agent is sent." },
  { slug: "trigger-measures", title: "Trigger measures", group: "Reference", icon: Zap, blurb: "Every condition a trigger can watch, its numbers, variables and settings, and the shape it's saved in." },
  { slug: "setups", title: "Setups", group: "Reference", icon: BookOpen, blurb: "Every setup in the playbook: what must be true, where the buy, floor and target go, and when it has failed." },
];

export function docBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}

/** The README is the Overview; it lives at /docs/overview. */
export const OVERVIEW = "README";

/** The front door, /docs: no doc of its own, just the cards. */
export const HOME = "home";

/** The sidebar's groups, in order, as docs/guide/ is foldered. */
export const GROUPS: ReadonlyArray<{ label: string; group: DocMeta["group"] }> = [
  { label: "Start here", group: "Overview" },
  { label: "Agents", group: "Agents" },
  { label: "Concepts", group: "Concepts" },
  { label: "Deep dives", group: "Deep dives" },
  { label: "Reference", group: "Reference" },
];

export const docHref = (slug: string) => (slug === OVERVIEW ? "/docs/overview" : `/docs/${slug}`);

/** The doc that explains a run, by the run's mode: the run page's "how it works" button opens it. */
export function docForRunMode(mode: string | null | undefined): DocSlug {
  switch (mode) {
    case "INTRADAY_TACTICAL":
      return "trigger-runs";
    case "DISCOVERY":
      return "discovery";
    case "THESIS_WRITER":
      return "writer";
    case "PRINCIPAL_CHAT":
      return "chat";
    default:
      return "morning-runs";
  }
}
