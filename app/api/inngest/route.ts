import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { priceMonitor } from "@/lib/inngest/functions/price-monitor";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [priceMonitor],
});
