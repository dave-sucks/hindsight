import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { priceMonitor } from "@/lib/inngest/functions/price-monitor";
import { evaluateTrade } from "@/lib/inngest/functions/trade-evaluator";
import { morningResearch } from "@/lib/inngest/functions/morning-research";
import { eodEvaluation } from "@/lib/inngest/functions/eod-evaluation";
import { weeklyDigest } from "@/lib/inngest/functions/weekly-digest";
import { accuracyScorer } from "@/lib/inngest/functions/accuracy-scorer";

// morning-research runs a full agent (generateText with 30 tool steps)
// inside a single step.run — needs extended timeout to avoid Vercel killing it
export const maxDuration = 300; // 5 min — covers multi-step agent runs

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [priceMonitor, evaluateTrade, morningResearch, eodEvaluation, weeklyDigest, accuracyScorer],
});
