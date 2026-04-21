"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, X, Clock, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  approveSuggestion,
  dismissSuggestion,
  snoozeSuggestion,
  unsnoozeSuggestion,
  type SuggestionBucket,
  type SuggestionView,
} from "@/lib/actions/suggestion.actions";
import {
  DISMISS_REASONS,
  DISMISS_REASON_LABELS,
  type DismissReason,
  type SuggestionKind,
  type ProposedDiff,
} from "@/lib/suggestions/types";

// ── Kind → label + tab grouping ───────────────────────────────────────────────

const KIND_LABELS: Record<SuggestionKind, string> = {
  PROMPT_EDIT: "Prompt edit",
  UNIVERSE_ADD_SECTOR: "Add sector",
  UNIVERSE_REMOVE_SECTOR: "Remove sector",
  UNIVERSE_ADD_INDUSTRY: "Add industry",
  UNIVERSE_REMOVE_INDUSTRY: "Remove industry",
  UNIVERSE_ADD_THEME: "Add theme",
  UNIVERSE_REMOVE_THEME: "Remove theme",
  WATCHLIST_ADD: "Watchlist add",
  WATCHLIST_REMOVE: "Watchlist remove",
  EXCLUSION_ADD: "Exclude",
  INTELLIGENCE_QUERY_ADD: "New query",
  INTELLIGENCE_QUERY_REMOVE: "Remove query",
  META_COMMENTARY: "Note",
};

function formatDiff(diff: ProposedDiff): React.ReactNode {
  switch (diff.kind) {
    case "PROMPT_EDIT":
      return (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</div>
          <p className="text-sm">{diff.summary}</p>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Full replacement prompt</div>
          <ScrollArea className="h-48 w-full rounded-md border">
            <pre className="whitespace-pre-wrap px-3 py-2 text-xs">{diff.nextAnalystPrompt}</pre>
          </ScrollArea>
        </div>
      );
    case "UNIVERSE_ADD_SECTOR":
    case "UNIVERSE_REMOVE_SECTOR":
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {diff.kind === "UNIVERSE_ADD_SECTOR" ? "Add sector" : "Remove sector"}
          </span>
          <Badge variant="secondary">{diff.sector}</Badge>
        </div>
      );
    case "UNIVERSE_ADD_INDUSTRY":
    case "UNIVERSE_REMOVE_INDUSTRY":
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {diff.kind === "UNIVERSE_ADD_INDUSTRY" ? "Add industry" : "Remove industry"}
          </span>
          <Badge variant="secondary">{diff.industry}</Badge>
        </div>
      );
    case "UNIVERSE_ADD_THEME":
    case "UNIVERSE_REMOVE_THEME":
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {diff.kind === "UNIVERSE_ADD_THEME" ? "Add theme" : "Remove theme"}
          </span>
          <Badge variant="secondary">{diff.theme}</Badge>
        </div>
      );
    case "WATCHLIST_ADD":
    case "WATCHLIST_REMOVE":
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {diff.kind === "WATCHLIST_ADD" ? "Add to watchlist" : "Remove from watchlist"}
          </span>
          <Badge variant="secondary">${diff.ticker}</Badge>
        </div>
      );
    case "EXCLUSION_ADD":
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exclude</span>
          <Badge variant="destructive">${diff.ticker}</Badge>
        </div>
      );
    case "INTELLIGENCE_QUERY_ADD":
      return (
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Add query ({diff.category.toLowerCase()})
          </div>
          <p className="text-sm italic">&ldquo;{diff.query}&rdquo;</p>
        </div>
      );
    case "INTELLIGENCE_QUERY_REMOVE":
      return (
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remove query</div>
          <p className="text-sm italic line-through text-muted-foreground">&ldquo;{diff.queryText}&rdquo;</p>
        </div>
      );
    case "META_COMMENTARY":
      return (
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Observation</div>
          <p className="text-sm">{diff.note}</p>
        </div>
      );
  }
}

// ── Dismiss dialog ────────────────────────────────────────────────────────────

function DismissDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: DismissReason, note: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState<DismissReason>("NOT_RELEVANT");
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why are you dismissing this?</DialogTitle>
          <DialogDescription>
            Your feedback trains the next weekly pass. Same proposal won&rsquo;t reappear for 60 days.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={reason} onValueChange={(v) => setReason(v as DismissReason)}>
          {DISMISS_REASONS.map((r) => (
            <div key={r} className="flex items-center gap-2">
              <RadioGroupItem id={`dismiss-${r}`} value={r} />
              <Label htmlFor={`dismiss-${r}`}>{DISMISS_REASON_LABELS[r]}</Label>
            </div>
          ))}
        </RadioGroup>
        <Textarea
          placeholder="Optional — what specifically was wrong?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason, note)} disabled={pending}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Single suggestion card ────────────────────────────────────────────────────

function SuggestionCard({ suggestion }: { suggestion: SuggestionView }) {
  const [pending, startTransition] = useTransition();
  const [dismissOpen, setDismissOpen] = useState(false);

  const isPending = suggestion.status === "PENDING";
  const isSnoozed = suggestion.status === "SNOOZED";
  const isActionable = isPending || isSnoozed;

  const handleApprove = () => {
    startTransition(async () => {
      try {
        await approveSuggestion(suggestion.id);
        toast.success("Applied");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to approve");
      }
    });
  };

  const handleDismiss = (reason: DismissReason, note: string) => {
    startTransition(async () => {
      try {
        await dismissSuggestion(suggestion.id, reason, note);
        toast.success("Dismissed");
        setDismissOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to dismiss");
      }
    });
  };

  const handleSnooze = () => {
    startTransition(async () => {
      try {
        await snoozeSuggestion(suggestion.id);
        toast.success("Snoozed for 7 days");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to snooze");
      }
    });
  };

  const handleUnsnooze = () => {
    startTransition(async () => {
      try {
        await unsnoozeSuggestion(suggestion.id);
        toast.success("Moved back to pending");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to unsnooze");
      }
    });
  };

  const expiresInDays = Math.max(
    0,
    Math.ceil((suggestion.expiresAt.getTime() - Date.now()) / 86_400_000),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{KIND_LABELS[suggestion.kind]}</Badge>
                {suggestion.status === "APPROVED" && <Badge variant="secondary">Approved</Badge>}
                {suggestion.status === "DISMISSED" && <Badge variant="outline">Dismissed</Badge>}
                {suggestion.status === "EXPIRED" && <Badge variant="outline">Expired</Badge>}
                {suggestion.status === "SNOOZED" && <Badge variant="outline">Snoozed</Badge>}
              </div>
              <CardTitle>{suggestion.title}</CardTitle>
              <CardDescription>{suggestion.rationale}</CardDescription>
            </div>
            {isPending && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {expiresInDays}d left
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Evidence */}
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</div>
              <p className="text-sm text-muted-foreground">{suggestion.evidence.patternSummary}</p>
              {suggestion.evidence.dataPoints.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestion.evidence.dataPoints.map((dp, i) => (
                    <Badge key={i} variant="outline">
                      {dp}
                    </Badge>
                  ))}
                </div>
              )}
              {suggestion.sourceRunId && (
                <Link
                  href={`/runs/${suggestion.sourceRunId}`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  View source run →
                </Link>
              )}
            </div>

            <Separator />

            {/* Proposed diff */}
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Proposed change</div>
              {formatDiff(suggestion.proposedDiff)}
            </div>

            {/* Resolved metadata */}
            {suggestion.resolvedAt && (
              <>
                <Separator />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {suggestion.status.toLowerCase()} on {suggestion.resolvedAt.toLocaleDateString()}
                  </span>
                  {suggestion.dismissReason && (
                    <Badge variant="outline">{DISMISS_REASON_LABELS[suggestion.dismissReason]}</Badge>
                  )}
                  {suggestion.dismissNote && <span className="italic">&ldquo;{suggestion.dismissNote}&rdquo;</span>}
                </div>
              </>
            )}
          </div>
        </CardContent>
        {isActionable && (
          <CardFooter>
            <div className="flex w-full items-center justify-end gap-2">
              {isSnoozed ? (
                <Button variant="ghost" size="sm" onClick={handleUnsnooze} disabled={pending}>
                  <Clock /> Unsnooze
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={handleSnooze} disabled={pending}>
                  <Clock /> Snooze 7d
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setDismissOpen(true)} disabled={pending}>
                <X /> Dismiss
              </Button>
              <Button size="sm" onClick={handleApprove} disabled={pending}>
                <Check /> Approve
              </Button>
            </div>
          </CardFooter>
        )}
      </Card>
      <DismissDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        onConfirm={handleDismiss}
        pending={pending}
      />
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SuggestionsClient({
  analystId,
  analystName,
  bucket,
}: {
  analystId: string;
  analystName: string;
  bucket: SuggestionBucket;
}) {
  const pendingCount = bucket.pending.length;
  const snoozedCount = bucket.snoozed.length;
  const resolvedCount = bucket.resolved.length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to analyst"
          render={<Link href={`/analysts/${analystId}`} />}
        >
          <ArrowLeft />
        </Button>
        <div className="flex-1 space-y-0.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {analystName}
          </div>
          <h1 className="text-2xl font-semibold">Suggestions</h1>
        </div>
      </div>

      <Card>
        <CardContent>
          <div className="flex items-start gap-3 py-1">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              The weekly self-improvement pass reviews the last 30 days of runs, trades, and briefings
              and proposes edits here. Nothing applies until you approve it. Dismissed proposals
              won&rsquo;t resurface for 60 days.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pendingCount})</TabsTrigger>
          <TabsTrigger value="snoozed">Snoozed ({snoozedCount})</TabsTrigger>
          <TabsTrigger value="resolved">Resolved ({resolvedCount})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {bucket.pending.length === 0 ? (
            <EmptyState
              title="No pending suggestions"
              body="The weekly pass runs Sundays at 11 AM ET. New proposals will appear here."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {bucket.pending.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="snoozed">
          {bucket.snoozed.length === 0 ? (
            <EmptyState title="Nothing snoozed" body="Snoozed proposals show up here for 7 days." />
          ) : (
            <div className="flex flex-col gap-4">
              {bucket.snoozed.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resolved">
          {bucket.resolved.length === 0 ? (
            <EmptyState
              title="No history yet"
              body="Once you approve or dismiss a proposal it moves here."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {bucket.resolved.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col items-center gap-1 py-6 text-center">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}
