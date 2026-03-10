"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, ArrowUp, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createAnalystFromWizard } from "@/lib/actions/analyst.actions";

// ── Types ─────────────────────────────────────────────────────────────────────

type HoldDuration = "DAY" | "SWING" | "POSITION";
type Direction = "LONG" | "SHORT" | "BOTH";

type WizardAnswers = {
  prompt: string;
  holdDurations: HoldDuration[];
  direction: Direction;
  maxPositionSize: number;
  minConfidence: number;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chips?: { label: string; value: string | number }[];
  isConfirmCard?: boolean;
};

// ── Derive a short name from prompt ──────────────────────────────────────────

function deriveAnalystName(prompt: string): string {
  const p = prompt.toLowerCase();
  const parts: string[] = [];

  if (p.includes("ev") || p.includes("electric vehicle")) parts.push("EV");
  else if (p.includes("tech") || p.includes("software")) parts.push("Tech");
  else if (p.includes("crypto") || p.includes("bitcoin")) parts.push("Crypto");
  else if (p.includes("biotech") || p.includes("pharma")) parts.push("Biotech");
  else if (p.includes("energy") || p.includes("oil")) parts.push("Energy");
  else if (p.includes("finance") || p.includes("bank")) parts.push("Finance");

  if (p.includes("day trade") || p.includes("intraday")) parts.push("Day Trader");
  else if (p.includes("swing")) parts.push("Swing Trader");
  else if (p.includes("momentum")) parts.push("Momentum");
  else if (p.includes("high risk") || p.includes("aggressive")) parts.push("Aggressive");
  else if (p.includes("conservative") || p.includes("safe")) parts.push("Conservative");

  if (parts.length === 0) return "New Analyst";
  if (parts.length === 1) return `${parts[0]} Analyst`;
  return parts.slice(0, 2).join(" ");
}

// ── Chip button ───────────────────────────────────────────────────────────────

function ChipButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
      )}
    >
      {label}
    </button>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  answers,
  onConfirm,
  creating,
}: {
  answers: WizardAnswers;
  onConfirm: () => void;
  creating: boolean;
}) {
  const name = deriveAnalystName(answers.prompt);
  const holdLabel =
    answers.holdDurations[0] === "DAY"
      ? "Day trades"
      : answers.holdDurations[0] === "SWING"
      ? "Swing trades"
      : "Position trades";
  const dirLabel =
    answers.direction === "LONG"
      ? "Long only"
      : answers.direction === "SHORT"
      ? "Short only"
      : "Long and short";

  return (
    <Card className="mt-1 max-w-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
          <p className="text-sm font-semibold">{name}</p>
        </div>
        <p className="text-xs text-muted-foreground italic leading-relaxed">
          &ldquo;{answers.prompt}&rdquo;
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {[
            { label: "Style", value: holdLabel },
            { label: "Direction", value: dirLabel },
            { label: "Max position", value: `$${answers.maxPositionSize.toLocaleString()}` },
            { label: "Min confidence", value: `${answers.minConfidence}%` },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-muted-foreground">{label}</p>
              <p className="font-medium">{value}</p>
            </div>
          ))}
        </div>
        <Button
          className="w-full"
          size="sm"
          onClick={onConfirm}
          disabled={creating}
        >
          {creating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              Creating…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Create Analyst
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Chat message ──────────────────────────────────────────────────────────────

function ChatMessage({
  msg,
  answers,
  onChipSelect,
  onConfirm,
  creating,
}: {
  msg: Message;
  answers: WizardAnswers;
  onChipSelect: (msgId: string, value: string | number) => void;
  onConfirm: () => void;
  creating: boolean;
}) {
  return (
    <div
      className={cn(
        "flex",
        msg.role === "user" ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          msg.role === "user"
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        )}
      >
        {msg.content}
        {msg.chips && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {msg.chips.map((chip) => (
              <ChipButton
                key={String(chip.value)}
                label={chip.label}
                onClick={() => onChipSelect(msg.id, chip.value)}
              />
            ))}
          </div>
        )}
        {msg.isConfirmCard && (
          <SummaryCard
            answers={answers}
            onConfirm={onConfirm}
            creating={creating}
          />
        )}
      </div>
    </div>
  );
}

// ── Wizard steps ──────────────────────────────────────────────────────────────

type Step = "prompt" | "duration" | "direction" | "position" | "confidence" | "confirm" | "done";

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystWizardClient() {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>("prompt");
  const [promptInput, setPromptInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "intro",
      role: "assistant",
      content:
        "Describe what you want this analyst to find. The more specific the better — mention sector, style, timeframe, anything.",
    },
  ]);
  const [answers, setAnswers] = useState<WizardAnswers>({
    prompt: "",
    holdDurations: ["SWING"],
    direction: "BOTH",
    maxPositionSize: 500,
    minConfidence: 70,
  });

  const nextId = () => `msg-${Date.now()}-${Math.random()}`;

  function addMessages(...msgs: Omit<Message, "id">[]) {
    setMessages((prev) => [
      ...prev,
      ...msgs.map((m) => ({ ...m, id: nextId() })),
    ]);
  }

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Step handlers ────────────────────────────────────────────────────────

  function handlePromptSubmit() {
    const prompt = promptInput.trim();
    if (!prompt) return;

    setAnswers((a) => ({ ...a, prompt }));
    addMessages(
      { role: "user", content: prompt },
      {
        role: "assistant",
        content: `Got it. I'll build an analyst around that. A few quick questions to configure it right:`,
      },
      {
        role: "assistant",
        content: "Will this analyst place day trades (close same day), swing trades (hold several days), or position trades (hold weeks)?",
        chips: [
          { label: "Day trade", value: "DAY" },
          { label: "Swing trade", value: "SWING" },
          { label: "Position", value: "POSITION" },
        ],
      }
    );
    setStep("duration");
    setPromptInput("");
  }

  function handleDurationSelect(value: string | number) {
    const hold = value as HoldDuration;
    setAnswers((a) => ({ ...a, holdDurations: [hold] }));
    const label =
      hold === "DAY" ? "day trades" : hold === "SWING" ? "swing trades" : "position trades";
    addMessages(
      { role: "user", content: hold === "DAY" ? "Day trade" : hold === "SWING" ? "Swing trade" : "Position" },
      {
        role: "assistant",
        content: `${label.charAt(0).toUpperCase() + label.slice(1)} — got it. Long only, short only, or both directions?`,
        chips: [
          { label: "Long only", value: "LONG" },
          { label: "Short only", value: "SHORT" },
          { label: "Both", value: "BOTH" },
        ],
      }
    );
    setStep("direction");
  }

  function handleDirectionSelect(value: string | number) {
    const dir = value as Direction;
    setAnswers((a) => ({ ...a, direction: dir }));
    const label =
      dir === "LONG" ? "Long only" : dir === "SHORT" ? "Short only" : "Both";
    addMessages(
      { role: "user", content: label },
      {
        role: "assistant",
        content: "Max to risk per trade? (This is paper money — no real funds involved.)",
        chips: [
          { label: "$250", value: 250 },
          { label: "$500", value: 500 },
          { label: "$1,000", value: 1000 },
          { label: "$2,500", value: 2500 },
        ],
      }
    );
    setStep("position");
  }

  function handlePositionSelect(value: string | number) {
    const size = Number(value);
    setAnswers((a) => ({ ...a, maxPositionSize: size }));
    addMessages(
      { role: "user", content: `$${size.toLocaleString()}` },
      {
        role: "assistant",
        content:
          "Min confidence before placing a trade? Higher = fewer but higher-conviction picks.",
        chips: [
          { label: "60% (permissive)", value: 60 },
          { label: "70% (balanced)", value: 70 },
          { label: "80% (selective)", value: 80 },
          { label: "90% (strict)", value: 90 },
        ],
      }
    );
    setStep("confidence");
  }

  function handleConfidenceSelect(value: string | number) {
    const conf = Number(value);
    setAnswers((a) => ({ ...a, minConfidence: conf }));
    const confLabel = `${conf}%`;
    addMessages(
      { role: "user", content: confLabel },
      {
        role: "assistant",
        content: "Here's your analyst. Ready to create it?",
        isConfirmCard: true,
      }
    );
    setStep("confirm");
  }

  // ── Chip select dispatcher ───────────────────────────────────────────────

  function handleChipSelect(msgId: string, value: string | number) {
    void msgId;
    if (step === "duration") handleDurationSelect(value);
    else if (step === "direction") handleDirectionSelect(value);
    else if (step === "position") handlePositionSelect(value);
    else if (step === "confidence") handleConfidenceSelect(value);
  }

  // ── Create analyst ───────────────────────────────────────────────────────

  async function handleCreate() {
    setCreating(true);
    try {
      const { id } = await createAnalystFromWizard({
        analystPrompt: answers.prompt,
        name: deriveAnalystName(answers.prompt),
        holdDurations: answers.holdDurations,
        directionBias: answers.direction,
        maxPositionSize: answers.maxPositionSize,
        minConfidence: answers.minConfidence,
      });
      router.push(`/analysts/${id}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-5.25rem)]">
      {/* Header */}
      <div className="border-b px-6 py-3 shrink-0 flex items-center gap-3">
        <Link
          href="/analysts"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-sm font-semibold">New Analyst</h1>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-xl mx-auto space-y-3">
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              msg={msg}
              answers={answers}
              onChipSelect={handleChipSelect}
              onConfirm={handleCreate}
              creating={creating}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Prompt input — only shown on first step */}
      {step === "prompt" && (
        <div className="border-t px-4 pb-4 pt-3 shrink-0">
          <div className="max-w-xl mx-auto">
            <div className="rounded-lg border bg-background">
              <Textarea
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handlePromptSubmit();
                  }
                }}
                placeholder="Find me high-risk EV day trades every morning…"
                className="min-h-[72px] max-h-[200px] resize-none border-0 shadow-none focus-visible:ring-0 bg-transparent text-sm"
              />
              <div className="flex justify-end px-3 pb-3">
                <Button
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  disabled={!promptInput.trim()}
                  onClick={handlePromptSubmit}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
