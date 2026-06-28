"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ingestThesisAction } from "@/lib/actions/thesis-ingest.actions";

interface AnalystOption {
  id: string;
  name: string;
  tradingEnvironment: string;
}

export function ThesisIngestForm({ analysts }: { analysts: AnalystOption[] }) {
  const [analystId, setAnalystId] = useState(analysts[0]?.id ?? "");
  const [json, setJson] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  async function onSubmit() {
    setPending(true);
    setResult(null);
    try {
      const res = await ingestThesisAction(analystId, json);
      if (res.ok) {
        setResult({ ok: true, message: res.summary });
        setJson("");
      } else {
        setResult({ ok: false, message: res.error });
      }
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Something went wrong.",
      });
    } finally {
      setPending(false);
    }
  }

  if (analysts.length === 0) {
    return (
      <Alert>
        <AlertTitle>No analysts yet</AlertTitle>
        <AlertDescription>
          Create an analyst first, then come back to ingest theses for it.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paste thesis JSON</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="analyst">Analyst</Label>
            <Select
              value={analystId}
              onValueChange={(value) => setAnalystId(value ?? "")}
            >
              <SelectTrigger id="analyst">
                <SelectValue placeholder="Select an analyst" />
              </SelectTrigger>
              <SelectContent>
                {analysts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.tradingEnvironment}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="json">Thesis JSON</Label>
            <Textarea
              id="json"
              rows={16}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder={'{\n  "ticker": "MU",\n  "direction": "LONG",\n  "horizon": "TARGET",\n  ...\n}'}
            />
          </div>

          <Button
            onClick={onSubmit}
            disabled={pending || !analystId || json.trim().length === 0}
          >
            {pending ? "Minting…" : "Mint thesis"}
          </Button>

          {result && (
            <Alert variant={result.ok ? "default" : "destructive"}>
              <AlertTitle>{result.ok ? "Thesis minted" : "Rejected"}</AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
