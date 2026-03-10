import { NextRequest } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// ─── Slash-command regex ───────────────────────────────────────────────────────

const CMD_CANCEL = /^\/cancel\b/i;
const CMD_SIZE = /^\/size\s+(\d+(?:\.\d+)?)/i;
const CMD_STOP = /^\/stop\s+(\d+(?:\.\d+)?)/i;
const CMD_TARGET = /^\/target\s+(\d+(?:\.\d+)?)/i;
const CMD_LIMIT = /^\/limit\s+(\d+(?:\.\d+)?)/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(theses: {
  ticker: string;
  direction: string;
  confidenceScore: number;
  reasoningSummary: string;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  trade: { status: string } | null;
}[]): string {
  const thesisSummaries = theses
    .map(
      (t) =>
        `- ${t.ticker}: ${t.direction} @ ${t.confidenceScore}% confidence` +
        (t.entryPrice ? `, entry $${t.entryPrice}` : "") +
        (t.targetPrice ? `, target $${t.targetPrice}` : "") +
        (t.stopLoss ? `, stop $${t.stopLoss}` : "") +
        (t.trade ? ` [trade: ${t.trade.status}]` : " [no trade]") +
        `\n  ${t.reasoningSummary ?? ""}`
    )
    .join("\n");

  return [
    "You are a financial research assistant reviewing a completed research run.",
    "Answer questions about the theses, reasoning, trade decisions, and risk factors.",
    "Be concise and reference specific numbers when relevant.",
    "Do not give investment advice or guarantee outcomes.",
    "",
    "Theses in this run:",
    thesisSummaries,
    "",
    "Use slash commands to manage trades:",
    "/cancel — cancel the most recent open trade",
    "/size N — set position size to $N",
    "/stop N — set stop loss to $N",
    "/target N — set target price to $N",
    "/limit N — note a limit price (informational only)",
  ].join("\n");
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;

  // ── Auth ───────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let message: string;
  try {
    const body = await req.json();
    message = String(body.message ?? "").trim();
    if (!message) throw new Error("empty");
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // ── Load run with theses + recent messages ─────────────────────────────────
  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId: user.id },
    include: {
      theses: {
        select: {
          id: true,
          ticker: true,
          direction: true,
          confidenceScore: true,
          reasoningSummary: true,
          entryPrice: true,
          targetPrice: true,
          stopLoss: true,
          trade: { select: { id: true, status: true, shares: true } },
        },
        orderBy: { confidenceScore: "desc" },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 20,
      },
    },
  });

  if (!run) {
    return new Response("Not found", { status: 404 });
  }

  // ── Persist user message ───────────────────────────────────────────────────
  await prisma.runMessage.create({
    data: { runId, role: "user", content: message },
  });

  // ── Slash command handling (non-streaming JSON response) ───────────────────
  const mostRecentOpenTrade = run.theses
    .map((t) => t.trade)
    .find((tr) => tr && tr.status === "OPEN");

  if (CMD_CANCEL.test(message)) {
    if (!mostRecentOpenTrade) {
      const reply = "No open trade found for this run.";
      await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
      return sseText(reply);
    }
    await prisma.trade.update({
      where: { id: mostRecentOpenTrade.id },
      data: { status: "CANCELLED" },
    });
    const reply = `Trade cancelled.`;
    await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
    return sseText(reply);
  }

  const sizeMatch = message.match(CMD_SIZE);
  if (sizeMatch) {
    const dollarAmount = parseFloat(sizeMatch[1]);
    if (!mostRecentOpenTrade) {
      const reply = "No open trade found for this run.";
      await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
      return sseText(reply);
    }
    const thesis = run.theses.find((t) => t.trade?.id === mostRecentOpenTrade.id);
    const entryPrice = thesis?.entryPrice ?? 1;
    const newShares = Math.floor(dollarAmount / entryPrice);
    await prisma.trade.update({
      where: { id: mostRecentOpenTrade.id },
      data: { shares: newShares },
    });
    const reply = `Position size updated to $${dollarAmount} (~${newShares} shares at $${entryPrice}).`;
    await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
    return sseText(reply);
  }

  const stopMatch = message.match(CMD_STOP);
  if (stopMatch) {
    const price = parseFloat(stopMatch[1]);
    if (!mostRecentOpenTrade) {
      const reply = "No open trade found for this run.";
      await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
      return sseText(reply);
    }
    await prisma.trade.update({
      where: { id: mostRecentOpenTrade.id },
      data: { stopLoss: price },
    });
    const reply = `Stop loss updated to $${price}.`;
    await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
    return sseText(reply);
  }

  const targetMatch = message.match(CMD_TARGET);
  if (targetMatch) {
    const price = parseFloat(targetMatch[1]);
    if (!mostRecentOpenTrade) {
      const reply = "No open trade found for this run.";
      await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
      return sseText(reply);
    }
    await prisma.trade.update({
      where: { id: mostRecentOpenTrade.id },
      data: { targetPrice: price },
    });
    const reply = `Target price updated to $${price}.`;
    await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
    return sseText(reply);
  }

  const limitMatch = message.match(CMD_LIMIT);
  if (limitMatch) {
    const price = parseFloat(limitMatch[1]);
    const reply = `Noted: limit price $${price} (informational only — full limit order support is a future feature).`;
    await prisma.runMessage.create({ data: { runId, role: "assistant", content: reply } });
    return sseText(reply);
  }

  // ── Streaming chat response ────────────────────────────────────────────────
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });

  const history: OpenAI.Chat.ChatCompletionMessageParam[] = run.messages.map(
    (m) => ({ role: m.role as "user" | "assistant", content: m.content })
  );
  // Append the new user message (already persisted above)
  history.push({ role: "user", content: message });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let accumulated = "";

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: buildSystemPrompt(run.theses) },
            ...history,
          ],
          stream: true,
          max_tokens: 1024,
        });

        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) {
            accumulated += text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "token", text })}\n\n`)
            );
          }
        }

        // Persist assistant reply
        await prisma.runMessage.create({
          data: { runId, role: "assistant", content: accumulated },
        });

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", text: msg })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── Helper: single-token SSE response (for slash command replies) ─────────────

function sseText(text: string): Response {
  const body = [
    `data: ${JSON.stringify({ type: "token", text })}\n`,
    `data: ${JSON.stringify({ type: "done" })}\n\n`,
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
