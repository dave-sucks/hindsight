"use client";

/** The pieces both /performance tabs are built from: a fetch with its states, figure tiles, a titled card, a plain table. */
import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** A chart's size: ShadCN's chart container is sized by the page, not restyled. */
export const chartSize = (height: number) => ({ aspectRatio: "auto", height, width: "100%" });

export const Num = ({ children }: { children: ReactNode }) => <div className="text-right tabular-nums">{children}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;

/** GET a tab's JSON, refetched when the URL changes; null while it loads. */
export function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setData(null);
    setError(null);
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => (r.ok ? setData((await r.json()) as T) : setError((await r.json().catch(() => null))?.error ?? `The server answered ${r.status}.`)))
      .catch((e) => { if (e?.name !== "AbortError") setError("Couldn't reach the server."); });
    return () => ctrl.abort();
  }, [url, attempt]);
  return { data, error, retry: () => setAttempt((n) => n + 1) };
}

/** What a tab shows until its numbers arrive, or when they can't. */
export function Loading({ error, what, onRetry }: { error: string | null; what: string; onRetry: () => void }) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load the {what}</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} style={{ height: 96 }} />)}</div>
      <Skeleton style={{ height: 256 }} />
      <Skeleton style={{ height: 384 }} />
    </div>
  );
}

export type Tile = { label: string; value: string; sub?: string; tone?: "positive" | "negative" };
export function Tiles({ tiles }: { tiles: Tile[] }) {
  const tone = { positive: "text-positive", negative: "text-negative" } as const;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <Card key={t.label} size="sm">
          <CardHeader>
            <CardDescription>{t.label}</CardDescription>
            <CardTitle><span className={`text-2xl font-semibold tabular-nums ${t.tone ? tone[t.tone] : ""}`}>{t.value}</span></CardTitle>
            {t.sub && <CardDescription>{t.sub}</CardDescription>}
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A table of plain cells. A column whose head is given as [label, "num"] is right-aligned in tabular figures. */
export function SimpleTable({ head, rows, empty }: { head: Array<string | [string, "num"]>; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const num = head.map((h) => typeof h !== "string");
  return (
    <Table>
      <TableHeader>
        <TableRow>{head.map((h) => (typeof h === "string" ? <TableHead key={h}>{h}</TableHead> : <TableHead key={h[0]}><Num>{h[0]}</Num></TableHead>))}</TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((cells, i) => <TableRow key={i}>{cells.map((c, j) => <TableCell key={j}>{num[j] ? <Num>{c}</Num> : c}</TableCell>)}</TableRow>)}
      </TableBody>
    </Table>
  );
}

const ALL = "all";
/**
 * The analyst picker, starting on "All analysts". Its list is kept while the
 * next numbers load: a picker whose items lose the chosen analyst drops back to All.
 */
export function AnalystFilter({ analysts, value, onChange }: { analysts?: Array<{ id: string; name: string }>; value: string | null; onChange: (id: string | null) => void }) {
  const [kept, setKept] = useState<Array<{ id: string; name: string }>>([]);
  if (analysts && analysts !== kept) setKept(analysts);
  const items = [{ value: ALL, label: "All analysts" }, ...(analysts ?? kept).map((a) => ({ value: a.id, label: a.name }))];
  return (
    <Select items={items} value={value ?? ALL} onValueChange={(v) => onChange(!v || v === ALL ? null : v)}>
      <SelectTrigger size="sm" aria-label="Filter by analyst"><SelectValue /></SelectTrigger>
      <SelectContent>{items.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}
