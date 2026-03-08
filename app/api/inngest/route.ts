import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { priceMonitor } from "@/lib/inngest/functions/price-monitor";
import { evaluateTrade } from "@/lib/inngest/functions/trade-evaluator";
import { morningResearch } from "@/lib/inngest/functions/morning-research";
import { eodEvaluation } from "@/lib/inngest/functions/eod-evaluation";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [priceMonitor, evaluateTrade, morningResearch, eodEvaluation],
});
