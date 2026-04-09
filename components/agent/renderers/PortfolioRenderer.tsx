"use client";

/**
 * PortfolioRenderer — renders get_portfolio_state results.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
} from "@/components/ai-elements/tool-progress";
import { Briefcase } from "lucide-react";

interface Props {
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function PortfolioRenderer({ result, loading }: Props) {
  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading} icon={Briefcase}>
        Portfolio review
      </ToolProgressHeader>
      <ToolProgressContent>
        <ToolProgressItem>{result.summary}</ToolProgressItem>
      </ToolProgressContent>
    </ToolProgress>
  );
}
