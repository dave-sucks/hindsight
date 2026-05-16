/**
 * /dev/thesis-bake-off — internal bake-off surface for THESIS_RESEARCH_V2 Phase 0.
 *
 * Enter a ticker → server pulls all the structured data (Finnhub + FMP +
 * SEC EDGAR) → renders the markdown data block + the full synthesis prompt
 * with copy buttons. Paste into Perplexity / Claude / ChatGPT / Gemini chat
 * UIs to compare outputs and pick the winning deep-research model.
 *
 * Not user-facing — internal tuning surface only. The actual production
 * thesis-writer agent in Phase 1 will use the same data tools and same
 * prompt builder via the `write_thesis_research` meta-tool.
 */
"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface BakeOffResult {
  ticker: string;
  pulledAt: string;
  dataBlock: string;
  fullPrompt: string;
  toolErrors: Record<string, string | null>;
}

const DEFAULT_ANALYST_CONTEXT =
  "Tech momentum analyst. Hunts secular AI / semiconductor leaders with clean breakout setups. Hold style: SWING to POSITION. Direction bias: LONG primarily. Sizes 4-6 names at $1500-2500 each. Trades on relative-strength + earnings inflection; respects 2:1 R/R minimum.";

const CHAT_LINKS = [
  { name: "Perplexity", url: "https://www.perplexity.ai/", subtitle: "Pick `sonar-deep-research` in the model picker" },
  { name: "Claude", url: "https://claude.ai/", subtitle: "Claude Sonnet 4.6 / Opus 4.7, enable Web Search" },
  { name: "ChatGPT", url: "https://chatgpt.com/", subtitle: "GPT-5 / o3 with web browsing enabled" },
  { name: "Gemini", url: "https://gemini.google.com/", subtitle: "Gemini 2.5 Pro with Google Search grounding" },
];

const RUBRIC = [
  "Fundamentals specificity (exact $ figures, %, dates)",
  "Earnings detail (transcript-derived bullets with numbers)",
  "Bull case substance (cited claims, not vapor)",
  "Bear case substance (real risks, cited)",
  "Analyst consensus depth (firm + analyst names, target deltas)",
  "Citation quality (working URLs, primary sources)",
  "Hallucination rate (spot-check 5 numbers against data block)",
];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export default function ThesisBakeOffPage() {
  const [ticker, setTicker] = useState("F");
  const [analystContext, setAnalystContext] = useState(DEFAULT_ANALYST_CONTEXT);
  const [mode, setMode] = useState<"mint" | "refresh">("mint");
  const [existingThesisSummary, setExistingThesisSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BakeOffResult | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/dev/bake-off-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          analystContext,
          mode,
          existingThesisSummary: mode === "refresh" ? existingThesisSummary : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
      } else {
        setResult(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const toolErrorEntries = result
    ? Object.entries(result.toolErrors).filter(([, v]) => v != null)
    : [];

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Thesis Bake-off</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Phase 0 of THESIS_RESEARCH_V2 — pull structured data + synthesis prompt for a ticker.
          Paste the output into Perplexity / Claude / ChatGPT / Gemini chat UIs to compare deep-research
          model quality.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ticker">Ticker</Label>
          <Input
            id="ticker"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="F"
            maxLength={8}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="analyst-context">Analyst context</Label>
          <Textarea
            id="analyst-context"
            value={analystContext}
            onChange={(e) => setAnalystContext(e.target.value)}
            rows={4}
            placeholder="Describe the analyst's strategy in 2-3 sentences..."
          />
        </div>

        <div className="space-y-2">
          <Label>Mode</Label>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "mint" | "refresh")}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="mint" id="mode-mint" />
              <Label htmlFor="mode-mint">Mint (net-new coverage)</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="refresh" id="mode-refresh" />
              <Label htmlFor="mode-refresh">Refresh (existing thesis)</Label>
            </div>
          </RadioGroup>
        </div>

        {mode === "refresh" && (
          <div className="space-y-2">
            <Label htmlFor="existing-thesis">Existing thesis summary</Label>
            <Textarea
              id="existing-thesis"
              value={existingThesisSummary}
              onChange={(e) => setExistingThesisSummary(e.target.value)}
              rows={4}
              placeholder="The current thesis on this name, in a few sentences..."
            />
          </div>
        )}

        <Button onClick={handleGenerate} disabled={loading || !ticker.trim()}>
          {loading ? "Pulling data…" : "Generate bake-off materials"}
        </Button>

        {error && (
          <div className="text-sm text-red-500">{error}</div>
        )}
      </Card>

      {result && (
        <>
          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">
                  Data block — ${result.ticker}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Pulled {new Date(result.pulledAt).toLocaleString()} · ~
                  {(result.dataBlock.length / 1024).toFixed(1)}KB
                </p>
              </div>
              <CopyButton text={result.dataBlock} label="Copy data block" />
            </div>
            {toolErrorEntries.length > 0 && (
              <div className="text-xs text-amber-500">
                <span className="font-medium">Partial data — </span>
                {toolErrorEntries.map(([k, v]) => `${k}: ${v}`).join("; ")}
              </div>
            )}
            <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto whitespace-pre max-h-96 overflow-y-auto font-mono">
              {result.dataBlock}
            </pre>
          </Card>

          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">Full synthesis prompt</h2>
                <p className="text-xs text-muted-foreground">
                  Paste this into a deep-research model. ~{(result.fullPrompt.length / 1024).toFixed(1)}KB.
                </p>
              </div>
              <CopyButton text={result.fullPrompt} label="Copy full prompt" />
            </div>
            <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto whitespace-pre max-h-96 overflow-y-auto font-mono">
              {result.fullPrompt}
            </pre>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-medium">Test in each model</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CHAT_LINKS.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <Card className="p-4 hover:bg-accent transition-colors">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium">{link.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">{link.subtitle}</div>
                      </div>
                      <ExternalLink className="size-4 text-muted-foreground shrink-0" />
                    </div>
                  </Card>
                </a>
              ))}
            </div>
          </Card>

          <Card className="p-6 space-y-3">
            <h2 className="text-lg font-medium">Scoring rubric</h2>
            <p className="text-sm text-muted-foreground">
              Score each model 1-5 on these dimensions. Total /35. Pick the winner.
            </p>
            <ol className="space-y-1 text-sm">
              {RUBRIC.map((r, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{i + 1}.</span> {r}
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}
