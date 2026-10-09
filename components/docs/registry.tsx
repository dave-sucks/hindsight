/**
 * Every page of the docs: its address, its name, where it sits on the home
 * page, and the component that draws it. The home page opens a page in a
 * sheet; /docs/[slug] draws the same component full width.
 */

import type { ComponentType } from "react";
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
import { AnalystsDoc } from "./content/analysts";
import { ApprovalsDoc } from "./content/approvals";
import { ChatDoc } from "./content/chat";
import { DiscoveryDoc } from "./content/discovery";
import { MorningRunsDoc } from "./content/morning-runs";
import { SituationsDoc } from "./content/situations";
import { ThesesDoc } from "./content/theses";
import { TriggerRunsDoc } from "./content/trigger-runs";
import { TriggersDoc } from "./content/triggers";
import { UnderTheHoodDoc } from "./content/under-the-hood";
import { WriterDoc } from "./content/writer";

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
  Content: ComponentType;
}

export const DOCS: readonly DocMeta[] = [
  { slug: "discovery", title: "Discovery", group: "Agents", icon: Search, Content: DiscoveryDoc, blurb: "Screens earnings, movers and the web for stocks that fit an analyst, and sends the best to the Writer." },
  { slug: "writer", title: "The Writer", group: "Agents", icon: PenLine, Content: WriterDoc, blurb: "Researches one stock in depth and writes its thesis, plan and all." },
  { slug: "morning-runs", title: "Morning runs", group: "Agents", icon: Sun, Content: MorningRunsDoc, blurb: "Every weekday morning, each analyst reviews its whole book." },
  { slug: "trigger-runs", title: "Trigger runs", group: "Agents", icon: Zap, Content: TriggerRunsDoc, blurb: "A trigger fires and the analyst looks at that one stock within minutes." },
  { slug: "chat", title: "Chat", group: "Agents", icon: MessageCircle, Content: ChatDoc, blurb: "Talk to one analyst, or to the whole account." },
  { slug: "theses", title: "Theses", group: "Concepts", icon: FileText, Content: ThesesDoc, blurb: "A belief we can be wrong about, and the plan that acts on it." },
  { slug: "triggers", title: "Triggers", group: "Concepts", icon: Zap, Content: TriggersDoc, blurb: "One sentence each: sell below, add above, review every 30 days." },
  { slug: "analysts", title: "Analysts", group: "Concepts", icon: UserRound, Content: AnalystsDoc, blurb: "A trading style with its own universe, sizing and sell rules." },
  { slug: "situations", title: "Situations", group: "Concepts", icon: Flag, Content: SituationsDoc, blurb: "The sixteen reasons a stock needs an answer today." },
  { slug: "approvals", title: "Approvals", group: "Concepts", icon: CheckCircle2, Content: ApprovalsDoc, blurb: "Analysts propose. You approve. Proposals expire after a day." },
  { slug: "under-the-hood", title: "Under the hood", group: "Concepts", icon: Layers, Content: UnderTheHoodDoc, blurb: "Data sources, schedules, models and the prompts themselves." },
];

export function docBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}
