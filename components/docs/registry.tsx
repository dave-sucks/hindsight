/**
 * Every page of the docs: its address, its name and where it sits on the
 * home page. What a page says is its markdown, docs/guide/<slug>.md. The
 * home page opens a page in a sheet; /docs/[slug] draws it full width.
 */

import {
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
  | "analysts"
  | "theses"
  | "triggers"
  | "situations"
  | "approvals"
  | "under-the-hood";

export interface DocMeta {
  slug: DocSlug;
  title: string;
  group: "Agents" | "Concepts";
  blurb: string;
  icon: LucideIcon;
}

export const DOCS: readonly DocMeta[] = [
  { slug: "discovery", title: "Discovery", group: "Agents", icon: Search, blurb: "Screens earnings, movers and the web for stocks that fit an analyst, and sends the best to the Writer." },
  { slug: "writer", title: "The Writer", group: "Agents", icon: PenLine, blurb: "Researches one stock in depth and writes its thesis, plan and all." },
  { slug: "morning-runs", title: "Morning runs", group: "Agents", icon: Sun, blurb: "Every weekday morning, each analyst reviews its whole book." },
  { slug: "trigger-runs", title: "Trigger runs", group: "Agents", icon: Zap, blurb: "A trigger fires and the analyst looks at that one stock within minutes." },
  { slug: "chat", title: "Chat", group: "Agents", icon: MessageCircle, blurb: "Talk to one analyst, or to the whole account." },
  { slug: "theses", title: "Theses", group: "Concepts", icon: FileText, blurb: "A belief we can be wrong about, and the plan that acts on it." },
  { slug: "triggers", title: "Triggers", group: "Concepts", icon: Zap, blurb: "One sentence each: sell below, add above, review every 30 days." },
  { slug: "analysts", title: "Analysts", group: "Concepts", icon: UserRound, blurb: "A trading style with its own universe, sizing and sell rules." },
  { slug: "situations", title: "Situations", group: "Concepts", icon: Flag, blurb: "The sixteen reasons a stock needs an answer today." },
  { slug: "approvals", title: "Approvals", group: "Concepts", icon: CheckCircle2, blurb: "Analysts propose. You approve. Proposals expire after a day." },
  { slug: "under-the-hood", title: "Under the hood", group: "Concepts", icon: Layers, blurb: "Data sources, schedules, models and the prompts themselves." },
];

export function docBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}
