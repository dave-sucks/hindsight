"use client";

/**
 * AskQuestionRenderer — renders an ask_question tool call using the
 * Tool-UI Question Flow library (https://www.tool-ui.com/docs/question-flow).
 *
 * Two emit shapes from the tool, dispatched here:
 *
 *  - **Progressive** (single question) → one quick-reply card, no step label.
 *  - **Upfront** (multi-step flow) → one card with "Step N of M" + progress
 *    bar; user answers each step inline; on Complete, all answers come
 *    back as one user message ("Q1: a, b. Q2: c.").
 *
 * After the user submits, we render the Receipt variant showing the
 * finalized choice(s) so the conversation reads cleanly on replay.
 *
 * If parsing fails we fall back to a bare text line — never crash the
 * thread on a malformed tool emission.
 */

import { useMemo, useState } from "react";
import { useThreadRuntime } from "@assistant-ui/react";
import type { ToolResult } from "@/lib/agent/tool-result";
import { QuestionFlow } from "@/components/tool-ui/question-flow";
import { safeParseSerializableQuestionFlow } from "@/components/tool-ui/question-flow/schema";
import type {
  SerializableProgressiveMode,
  SerializableUpfrontMode,
  QuestionFlowSummaryItem,
} from "@/components/tool-ui/question-flow/schema";

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function AskQuestionRenderer({ result }: Props) {
  const threadRuntime = useThreadRuntime();
  const [answered, setAnswered] = useState(false);
  const [receiptSummary, setReceiptSummary] = useState<{
    title: string;
    items: QuestionFlowSummaryItem[];
  } | null>(null);

  // Validate the payload against the Question Flow library schema.
  const parsed = useMemo(
    () => safeParseSerializableQuestionFlow(result.data),
    [result.data],
  );

  if (!parsed) {
    return <p className="text-sm text-muted-foreground">{result.summary}</p>;
  }

  // Receipt mode — show the finalized answers post-submit.
  if (answered && receiptSummary) {
    return (
      <QuestionFlow
        id={parsed.id}
        choice={{
          title: receiptSummary.title,
          summary: receiptSummary.items,
        }}
      />
    );
  }

  // ── Upfront (multi-step) mode ─────────────────────────────────────────
  if ("steps" in parsed && Array.isArray(parsed.steps)) {
    const upfront = parsed as SerializableUpfrontMode;

    const handleComplete = (answers: Record<string, string[]>) => {
      if (answered) return;
      const items: QuestionFlowSummaryItem[] = [];
      const messageLines: string[] = [];
      for (const step of upfront.steps) {
        const ids = answers[step.id] ?? [];
        const labels = ids
          .map((id) => step.options.find((o) => o.id === id)?.label)
          .filter((l): l is string => typeof l === "string");
        if (labels.length === 0) continue;
        const value = labels.join(", ");
        items.push({ label: step.title, value });
        messageLines.push(`${step.title} ${value}`);
      }
      if (items.length === 0) return;
      setReceiptSummary({ title: "Your answers", items });
      setAnswered(true);
      threadRuntime.append({
        role: "user",
        content: [{ type: "text", text: messageLines.join("\n") }],
      });
    };

    return (
      <QuestionFlow
        id={upfront.id}
        steps={upfront.steps}
        onComplete={handleComplete}
      />
    );
  }

  // ── Progressive (single-question) mode ────────────────────────────────
  if (!("options" in parsed)) {
    return <p className="text-sm text-muted-foreground">{result.summary}</p>;
  }

  const progressive = parsed as SerializableProgressiveMode;

  const handleSelect = (optionIds: string[]) => {
    if (answered) return;
    const labels = optionIds
      .map((id) => progressive.options.find((o) => o.id === id)?.label)
      .filter((l): l is string => typeof l === "string");
    if (labels.length === 0) return;
    setReceiptSummary({
      title: progressive.title,
      items: [{ label: "Answer", value: labels.join(", ") }],
    });
    setAnswered(true);
    threadRuntime.append({
      role: "user",
      content: [{ type: "text", text: labels.join(", ") }],
    });
  };

  return (
    <QuestionFlow
      id={progressive.id}
      step={progressive.step}
      title={progressive.title}
      description={progressive.description}
      options={progressive.options}
      selectionMode={progressive.selectionMode ?? "single"}
      onSelect={handleSelect}
    />
  );
}
