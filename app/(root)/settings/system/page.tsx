import {
  Bot,
  Clock,
  Play,
  ArrowRight,
  RotateCcw,
  Briefcase,
  Settings2,
  Zap,
  BookOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";

// ── Section wrapper ───────────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function SystemReferencePage() {
  return (
    <div className="p-6 max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">System Reference</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How agents, runs, and the learning loop work end-to-end
        </p>
      </div>

      <Separator />

      {/* ── 1. AGENT ────────────────────────────────────────────────── */}

      <Section label="The Agent">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-medium">Agent (Analyst)</h2>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              An agent is an autonomous AI research analyst configured with a
              strategy, trading rules, and preferences. Each agent is stored as
              an <code className="text-xs bg-muted px-1 py-0.5 rounded">AgentConfig</code> row
              in the database. Agents run daily via cron or on-demand via the
              Run button.
            </p>

            <Separator />

            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              <InfoRow label="Model" value="GPT-4.1 (tool calling)" />
              <InfoRow label="Max tool steps" value="30 per run" />
              <InfoRow label="Tools available" value="16 research + trading" />
              <InfoRow label="Learning" value="Briefings after every run" />
            </div>

            <Separator />

            <p className="text-xs font-medium text-muted-foreground">
              Key config fields
            </p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              <InfoRow label="analystPrompt" value="Strategy playbook (freeform)" />
              <InfoRow label="directionBias" value="LONG | SHORT | BOTH" />
              <InfoRow label="sectors" value="Focus areas (TECH, FINANCE...)" />
              <InfoRow label="signalTypes" value="EARNINGS_BEAT, SECTOR_ROTATION..." />
              <InfoRow label="minConfidence" value="Threshold % to place a trade" />
              <InfoRow label="maxPositionSize" value="Max $ per trade" />
              <InfoRow label="maxOpenPositions" value="Per-analyst concurrent limit" />
              <InfoRow label="watchlist" value="Always research first" />
              <InfoRow label="exclusionList" value="Never trade these" />
              <InfoRow label="holdDurations" value="DAY | SWING | POSITION" />
              <InfoRow label="enabled" value="Toggles cron scheduling" />
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* ── 2. CRON vs MANUAL ───────────────────────────────────────── */}

      <Section label="How Runs Get Triggered">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Cron */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">Cron Run</h2>
                <Badge variant="secondary">Automatic</Badge>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                Inngest fires <code className="text-xs bg-muted px-1 py-0.5 rounded">morning-research</code> at
                8:00 AM ET every weekday. It loops through all enabled agents
                and runs each one sequentially.
              </p>

              <Separator />

              <div className="space-y-2">
                <InfoRow label="Schedule" value="8 AM ET, Mon-Fri" />
                <InfoRow label="Timezone" value="America/New_York (auto EDT/EST)" />
                <InfoRow label="Route" value="/api/inngest (POST)" />
                <InfoRow label="Execution" value="generateText() (no streaming)" />
                <InfoRow label="Concurrency" value="1 at a time (sequential)" />
                <InfoRow label="Timeout" value="300s (maxDuration on route)" />
                <InfoRow label="Retries" value="1 retry on failure" />
                <InfoRow label="Source field" value='source: "AGENT"' />
              </div>

              <Separator />

              <p className="text-xs font-medium text-muted-foreground">Flow</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Inngest triggers at 8 AM ET</li>
                <li>Load all enabled AgentConfigs</li>
                <li>For each: count per-analyst open positions</li>
                <li>Create ResearchRun (status: RUNNING)</li>
                <li>Build system prompt + historical context</li>
                <li>generateText() with 30 tool steps</li>
                <li>Mark run COMPLETE, persist messages</li>
                <li>Generate analyst briefing</li>
              </ol>

              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  <strong>Rule:</strong> The run always executes, even if
                  maxOpenPositions is reached. The agent researches and writes
                  theses regardless — it just won&apos;t place new trades when
                  at capacity.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Manual */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Play className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">Manual Run</h2>
                <Badge variant="secondary">On-demand</Badge>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                User clicks &ldquo;Run&rdquo; on an analyst&apos;s page. Creates a
                ResearchRun row, redirects to the run page, and streams the
                agent&apos;s work in real time via the chat UI.
              </p>

              <Separator />

              <div className="space-y-2">
                <InfoRow label="Trigger" value="Run button on analyst page" />
                <InfoRow label="Creates run via" value="POST /api/research/agent-run" />
                <InfoRow label="Streams via" value="POST /api/research/agent" />
                <InfoRow label="Execution" value="streamText() (live to browser)" />
                <InfoRow label="UI component" value="AgentThread + AssistantUI" />
                <InfoRow label="Timeout" value="120s (maxDuration on route)" />
                <InfoRow label="Source field" value='source: "MANUAL"' />
              </div>

              <Separator />

              <p className="text-xs font-medium text-muted-foreground">Flow</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Click Run &rarr; POST /api/research/agent-run</li>
                <li>Create ResearchRun (status: RUNNING)</li>
                <li>Redirect to /runs/[id]</li>
                <li>AgentThread sends &ldquo;Run&rdquo; message</li>
                <li>streamText() with tool UIs rendering live</li>
                <li>On finish: persist messages, generate briefing</li>
                <li>Run page switches to replay mode</li>
              </ol>

              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  <strong>Key difference:</strong> Manual runs stream to the
                  browser with rich tool UIs (cards, charts). Cron runs use
                  generateText() with no client — same tools, same agent, just
                  no live rendering.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ── 3. WHAT HAPPENS DURING A RUN ────────────────────────────── */}

      <Section label="Inside a Run">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">The Research Pipeline</h2>
              </div>
              <HowItWorksSheet flow="agent-run">
                <BookOpen className="h-4 w-4" />
              </HowItWorksSheet>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Every run follows a 4-phase funnel: Discovery &rarr; Deep Research
              &rarr; Decision &rarr; Synthesis. The agent calls tools
              autonomously and narrates its reasoning between each step. Open
              the detail sheet for a breakdown of all 9 steps.
            </p>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {[
                {
                  phase: "Discovery",
                  tools: [
                    "get_market_overview",
                    "detect_market_themes",
                    "scan_catalysts",
                    "scan_candidates",
                  ],
                  summary: "Read regime, find themes, scan candidates",
                },
                {
                  phase: "Deep Research",
                  tools: [
                    "get_stock_data",
                    "get_technical_analysis",
                    "get_earnings_data",
                    "get_reddit_sentiment",
                    "get_analyst_targets",
                    "get_news_deep_dive",
                    "get_sec_filings",
                    "get_company_peers",
                    "get_unusual_options_flow",
                  ],
                  summary: "Per-ticker deep dive across all data sources",
                },
                {
                  phase: "Decision",
                  tools: ["show_thesis", "place_trade"],
                  summary: "Thesis for every ticker, trade if confident",
                },
                {
                  phase: "Synthesis",
                  tools: ["summarize_run"],
                  summary: "Portfolio review, risk check, daily summary",
                },
              ].map((p) => (
                <div
                  key={p.phase}
                  className="rounded-md border border-border/60 p-3 space-y-2"
                >
                  <Badge variant="outline">{p.phase}</Badge>
                  <p className="text-xs text-muted-foreground">{p.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {p.tools.map((t) => (
                      <code
                        key={t}
                        className="text-[10px] bg-muted px-1 py-0.5 rounded"
                      >
                        {t}
                      </code>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            <p className="text-xs font-medium text-muted-foreground">
              System prompt context injected per run
            </p>
            <div className="space-y-2">
              <InfoRow
                label="Recent briefings"
                value="3 most recent self-assessments (600 words each)"
              />
              <InfoRow
                label="Open positions"
                value="All current trades with entry/target/stop"
              />
              <InfoRow
                label="Trade history"
                value="20 most recent closed trades with P&L + evaluations"
              />
              <InfoRow
                label="Shadow trades"
                value="10 most recent pass results (good pass / bad pass)"
              />
              <InfoRow
                label="Accuracy stats"
                value="Win rate, calibration narrative from latest report"
              />
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* ── 4. LEARNING LOOP ────────────────────────────────────────── */}

      <Section label="Learning Loop">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-medium">
                How the Agent Learns Between Runs
              </h2>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              After every run (cron or manual), the system generates
              an <code className="text-xs bg-muted px-1 py-0.5 rounded">AnalystBriefing</code> —
              a self-assessment that gets injected into the next run&apos;s
              prompt. This creates a feedback loop: each session reads prior
              sessions and adjusts.
            </p>

            <Separator />

            {/* Flow diagram */}
            <div className="flex items-center gap-3 overflow-x-auto py-2">
              {[
                { icon: Zap, label: "Run completes" },
                { icon: ArrowRight, label: "" },
                { icon: Briefcase, label: "Briefing generated" },
                { icon: ArrowRight, label: "" },
                { icon: Settings2, label: "Stored in DB" },
                { icon: ArrowRight, label: "" },
                { icon: Bot, label: "Injected into next run" },
              ].map((step, i) =>
                step.label === "" ? (
                  <ArrowRight
                    key={i}
                    className="h-4 w-4 text-muted-foreground shrink-0"
                  />
                ) : (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-1 shrink-0"
                  >
                    <div className="h-8 w-8 rounded-full border border-border flex items-center justify-center">
                      <step.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="text-[10px] text-muted-foreground text-center whitespace-nowrap">
                      {step.label}
                    </span>
                  </div>
                ),
              )}
            </div>

            <Separator />

            <p className="text-xs font-medium text-muted-foreground">
              What the briefing captures
            </p>
            <div className="space-y-2">
              <InfoRow
                label="narrative"
                value="AI-written portfolio standup (400-600 words)"
              />
              <InfoRow
                label="strategyNotes"
                value="Data-driven adjustments (100-200 words)"
              />
              <InfoRow
                label="portfolioSnapshot"
                value="Open positions, P&L, win rate, total runs"
              />
              <InfoRow
                label="theses"
                value="Structured theses from this run"
              />
              <InfoRow
                label="trades"
                value="Structured trades from this run"
              />
              <InfoRow
                label="marketContext"
                value="Market summary from summarize_run"
              />
            </div>

            <Separator />

            <p className="text-xs font-medium text-muted-foreground">
              Other learning inputs
            </p>
            <div className="space-y-2">
              <InfoRow
                label="Price monitor"
                value="Hourly 9-5 ET: checks exits, logs TradeEvents"
              />
              <InfoRow
                label="EOD evaluation"
                value="5 PM ET: evaluates all trades placed today"
              />
              <InfoRow
                label="Trade evaluator"
                value="GPT-4o post-trade eval on close"
              />
              <InfoRow
                label="Accuracy scorer"
                value="Weekly: win rate, calibration, narrative"
              />
              <InfoRow
                label="Weekly digest"
                value="Sunday 9 AM: email summary of the week"
              />
            </div>

            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                <strong>The loop:</strong> Run &rarr; Briefing &rarr; Next
                run reads briefing &rarr; Agent adjusts strategy &rarr; Run
                &rarr; Briefing... Each agent accumulates an evolving memory of
                what worked and what didn&apos;t.
              </p>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* ── 5. CRON SCHEDULE REFERENCE ──────────────────────────────── */}

      <Section label="All Cron Schedules">
        <Card>
          <CardContent className="p-6">
            <div className="space-y-2">
              <InfoRow label="morning-research" value="8:00 AM ET Mon-Fri" />
              <InfoRow label="price-monitor" value="Hourly 9 AM - 5 PM ET Mon-Fri" />
              <InfoRow label="eod-evaluation" value="5:00 PM ET Mon-Fri" />
              <InfoRow label="trade-evaluator" value="Event-driven (on trade close)" />
              <InfoRow label="weekly-digest" value="Sunday 9:00 AM ET" />
              <InfoRow label="accuracy-scorer" value="Sunday 10:00 AM ET" />
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              All schedules use <code className="text-[10px] bg-muted px-1 py-0.5 rounded">TZ=America/New_York</code> —
              auto-adjusts for EDT/EST.
            </p>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
