"use client";

/**
 * RunRequests — what the model was sent, on a run's first message.
 *
 * One chip per distinct piece a model call passed in, each with its size in
 * characters: the instructions, the first message, the tool menu, every tool
 * result as the model read it, and any nudge added for one request. A chip
 * opens the piece's full text; from there, any request of the call as the
 * raw JSON that went to the provider. A run with several model calls (a
 * retry, a recovery, a chat's turns) picks one.
 *
 * Read from /api/runs/[id]/requests when the thread opens or a live call
 * ends, never in the page load. The records are kept by
 * lib/agent/run-requests.ts; a run from before them says so, and so does a
 * run that kept no model call (a trigger run that never called the model).
 */

import { useEffect, useMemo, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JsonBlock } from "@/components/ai-elements/json-block";
import type {
  RequestCallSummary,
  RequestPieceSummary,
  RunRequestBodyResponse,
  RunRequestPieceResponse,
  RunRequestsResponse,
} from "@/app/api/runs/[id]/requests/route";

/** Chips shown before "more". */
const FIRST_CHIPS = 12;

const PROVIDERS: Record<string, string> = {
  "openai.chat": "OpenAI (Chat Completions)",
  "openai.responses": "OpenAI (Responses)",
  "anthropic.messages": "Anthropic",
};

const chars = (n: number) => `${n.toLocaleString("en-US")} chars`;

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" })} ET`;
}

function callLabel(c: RequestCallSummary): string {
  const at = timeOf(c.startedAt);
  return `${c.call}${at ? ` · ${at}` : ""} · ${c.requests} request${c.requests === 1 ? "" : "s"}`;
}

function inRequests(p: RequestPieceSummary, of: number): string {
  if (p.request === p.lastRequest) return `request ${p.request} of ${of}`;
  return `requests ${p.request}–${p.lastRequest} of ${of}`;
}

function parsedJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

type Load<T> = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: T };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export function RunRequests({ runId }: { runId: string }) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const [state, setState] = useState<Load<RunRequestsResponse>>({ kind: "loading" });
  const [callId, setCallId] = useState<string | null>(null);
  const [opened, setOpened] = useState<RequestPieceSummary | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Read when the thread is idle: on open, and again when a live call ends.
  useEffect(() => {
    if (isRunning) return;
    let live = true;
    getJson<RunRequestsResponse>(`/api/runs/${runId}/requests`)
      .then((data) => live && setState({ kind: "ready", data }))
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [runId, isRunning]);

  const calls = state.kind === "ready" ? state.data.calls : [];
  const call = calls.find((c) => c.id === callId) ?? calls[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-(--thread-max-width) px-2 pt-3">
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sent to the model</span>
          {calls.length > 1 && call ? (
            <Select value={call.id} onValueChange={(v) => v && (setCallId(v), setShowAll(false))}>
              <SelectTrigger size="sm" aria-label="Model call">
                <SelectValue>{callLabel(call)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {calls.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {callLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : call ? (
            <span className="text-xs text-muted-foreground tabular-nums">{callLabel(call)}</span>
          ) : null}
        </div>

        {state.kind === "loading" && (
          <p className="text-sm text-muted-foreground">{isRunning ? "Recording; opens when the run ends." : "Loading what the model was sent…"}</p>
        )}
        {state.kind === "error" && <p className="text-sm text-muted-foreground">Couldn&apos;t load what the model was sent.</p>}
        {state.kind === "ready" && !call && (
          <p className="text-sm text-muted-foreground text-right">
            {state.data.status === "RUNNING"
              ? "What the model is sent is kept when its call ends."
              : state.data.before
                ? "This run is from before runs kept what they sent the model, so there is nothing to show."
                : "No model call of this run was kept."}
          </p>
        )}

        {call && (
          <>
            <div className="flex flex-wrap justify-end gap-1.5">
              {(showAll ? call.pieces : call.pieces.slice(0, FIRST_CHIPS)).map((p) => (
                <Button key={p.id} variant="outline" size="xs" onClick={() => setOpened(p)}>
                  <span>
                    {p.label}
                    {p.hint ? ` · ${p.hint}` : ""}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{chars(p.chars)}</span>
                </Button>
              ))}
              {call.pieces.length > FIRST_CHIPS && (
                <Button variant="ghost" size="xs" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Fewer" : `${call.pieces.length - FIRST_CHIPS} more`}
                </Button>
              )}
            </div>
            {call.requests === 0 && <p className="text-sm text-muted-foreground text-right">No request of this call got a reply.</p>}
            {call.error && (
              <p className="text-sm text-muted-foreground text-right">
                This call ended early: {call.error}. A request still waiting on its reply then isn&apos;t kept.
              </p>
            )}
          </>
        )}
      </div>

      {call && (
        <PieceSheet runId={runId} call={call} piece={opened} onClose={() => setOpened(null)} />
      )}
    </div>
  );
}

function PieceSheet({
  runId,
  call,
  piece,
  onClose,
}: {
  runId: string;
  call: RequestCallSummary;
  piece: RequestPieceSummary | null;
  onClose: () => void;
}) {
  const [text, setText] = useState<Load<string>>({ kind: "loading" });
  const [view, setView] = useState<"sent" | "formatted">("sent");
  const [requestNo, setRequestNo] = useState<number>(1);
  const [raw, setRaw] = useState<Load<RunRequestBodyResponse> | null>(null);
  const [rawView, setRawView] = useState<"sent" | "filled">("sent");

  useEffect(() => {
    if (!piece) return;
    let live = true;
    setText({ kind: "loading" });
    setView("sent");
    setRequestNo(piece.request);
    setRaw(null);
    setRawView("sent");
    getJson<RunRequestPieceResponse>(`/api/runs/${runId}/requests?call=${encodeURIComponent(call.id)}&piece=${encodeURIComponent(piece.id)}`)
      .then((d) => live && setText({ kind: "ready", data: d.text }))
      .catch(() => live && setText({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [runId, call.id, piece]);

  const json = useMemo(() => (text.kind === "ready" ? parsedJson(text.data) : { ok: false as const }), [text]);

  function showRequest() {
    setRaw({ kind: "loading" });
    setRawView("sent");
    getJson<RunRequestBodyResponse>(`/api/runs/${runId}/requests?call=${encodeURIComponent(call.id)}&request=${requestNo}`)
      .then((d) => setRaw({ kind: "ready", data: d }))
      .catch(() => setRaw({ kind: "error" }));
  }

  async function copyRequest(body: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(body));
      toast.success(`Request ${requestNo} copied, exactly as sent`);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  const provider = (call.provider && PROVIDERS[call.provider]) ?? call.provider ?? "the provider";

  return (
    <Sheet open={piece !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" size="xl" floating>
        {piece && (
          <>
            <SheetHeader>
              <SheetTitle>
                {piece.label}
                {piece.hint ? ` · ${piece.hint}` : ""}
              </SheetTitle>
              <SheetDescription>
                <span className="tabular-nums">{chars(piece.chars)}</span> as sent, in <span className="tabular-nums">{inRequests(piece, call.requests)}</span> of the {call.call} call
                {call.model ? ` to ${call.model}` : ""}.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-6">
              <section className="space-y-2">
                {json.ok && (
                  <Tabs value={view} onValueChange={(v) => setView(v as "sent" | "formatted")}>
                    <TabsList size="sm">
                      <TabsTrigger value="sent">As sent</TabsTrigger>
                      <TabsTrigger value="formatted">Formatted</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                {text.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
                {text.kind === "error" && <p className="text-sm text-muted-foreground">Couldn&apos;t load this piece.</p>}
                {text.kind === "ready" &&
                  (json.ok ? (
                    view === "formatted" ? <JsonBlock value={json.value} /> : <JsonBlock text={text.data} />
                  ) : (
                    <div className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm text-foreground">{text.data}</div>
                  ))}
              </section>

              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Raw request</p>
                <p className="text-sm text-muted-foreground">
                  Each request resends the whole conversation. Pick one to see it exactly as it went to {provider}.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={String(requestNo)} onValueChange={(v) => v && (setRequestNo(Number(v)), setRaw(null))}>
                    <SelectTrigger size="sm" aria-label="Request">
                      <SelectValue>
                        <span className="tabular-nums">{`Request ${requestNo} of ${call.requests}`}</span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: call.requests }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {`Request ${n}${n === piece.request ? " (first with this piece)" : ""}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={showRequest} disabled={call.requests === 0}>
                    Show request {requestNo}
                  </Button>
                </div>
                {raw?.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
                {raw?.kind === "error" && <p className="text-sm text-muted-foreground">Couldn&apos;t load this request.</p>}
                {raw?.kind === "ready" && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {raw.data.filled !== null && (
                        <Tabs value={rawView} onValueChange={(v) => setRawView(v as "sent" | "filled")}>
                          <TabsList size="sm">
                            <TabsTrigger value="sent">As sent</TabsTrigger>
                            <TabsTrigger value="filled">References filled in</TabsTrigger>
                          </TabsList>
                        </Tabs>
                      )}
                      <Button variant="ghost" size="xs" onClick={() => copyRequest(raw.data.body)}>
                        Copy as sent
                      </Button>
                    </div>
                    {raw.data.filled !== null && rawView === "filled" && (
                      <p className="text-sm text-muted-foreground">
                        The model&apos;s own earlier output went back by id. Each id is shown here with what the model wrote,
                        under &quot;filled_in_not_sent&quot;; that part was not in the request.
                      </p>
                    )}
                    {raw.data.body === null ? (
                      <p className="text-sm text-muted-foreground">The SDK handed over no body for this request.</p>
                    ) : (
                      <JsonBlock value={rawView === "filled" && raw.data.filled !== null ? raw.data.filled : raw.data.body} />
                    )}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
