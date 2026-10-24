import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoRow } from "@/components/ui/info-row";
import type { StockProfile } from "@/lib/actions/finnhub.actions";

/**
 * StockInfoCard — the company's identity numbers in one card, shared by the
 * thesis page and the stock page. The stock page adds its market rows
 * (market cap, P/E, 52-week range) through `extra`.
 */
export function StockInfoCard({
  symbol,
  profile,
  extra = [],
}: {
  symbol: string;
  profile: StockProfile | null;
  extra?: Array<{ label: string; value: string }>;
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Symbol", value: symbol },
    { label: "Exchange", value: profile?.exchange || "—" },
    { label: "Industry", value: profile?.finnhubIndustry || "—" },
    ...(profile?.ipo ? [{ label: "IPO", value: profile.ipo }] : []),
    { label: "Country", value: profile?.country || "—" },
    ...extra,
  ];
  const site = profile?.weburl ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Company</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          {rows.map((r, i) => (
            <InfoRow key={r.label} label={r.label} value={r.value} mono border={i < rows.length - 1 || site != null} />
          ))}
          {site ? (
            <a
              href={site}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
