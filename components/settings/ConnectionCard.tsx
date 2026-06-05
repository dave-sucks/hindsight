"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * ConnectionCard — Linear-style "Connected accounts" card.
 *
 * Two shapes:
 *
 * 1. Single-row connector (e.g. ElevenLabs):
 *      <ConnectionCard logo={<Img/>} title="ElevenLabs TTS"
 *                      description="Text-to-speech for podcast generation."
 *                      status="connected" />
 *
 * 2. Multi-account connector (e.g. Alpaca with Paper + Live, GitHub with
 *    multiple orgs):
 *      <ConnectionCard logo={<Img/>} title="Alpaca"
 *                      description="Paper and live trading.">
 *        <ConnectionSubRow ... />
 *        <ConnectionSubRow ... />
 *      </ConnectionCard>
 *
 * Visual: rounded Card with header row (logo + title + description) and an
 * optional vertical stack of sub-rows divided from the header by a thin
 * border. Each sub-row is `<ConnectionSubRow>` and can be expanded inline
 * via Collapsible for actions/edit forms.
 */
export function ConnectionCard({
  logo,
  title,
  description,
  status,
  trailing,
  children,
}: {
  logo: React.ReactNode;
  title: string;
  description?: string;
  /** Right-edge status pill on the header row. Omit when sub-rows carry status. */
  status?: "connected" | "configured" | "not-connected";
  /** Right-edge custom slot (overrides `status`). Use for connect buttons etc. */
  trailing?: React.ReactNode;
  /** Optional sub-rows. */
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-3 min-h-12">
          <div className="shrink-0">{logo}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{title}</p>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {trailing ?? (status && <ConnectionStatusBadge status={status} />)}
        </div>
        {children && (
          <div className="border-t -mx-4 mt-3 divide-y">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * ConnectionSubRow — one row inside a multi-account ConnectionCard.
 *
 * Left: label (e.g. "Paper") + secondary text (e.g. key hint).
 * Right: status badge + trailing slot (typically a CollapsibleTrigger
 * chevron). The caller wraps this row in a `<Collapsible>` to enable
 * inline expand-for-edit.
 */
export function ConnectionSubRow({
  label,
  secondary,
  status,
  trailing,
  children,
}: {
  label: React.ReactNode;
  secondary?: React.ReactNode;
  status?: "connected" | "configured" | "not-connected";
  /** Right-edge slot for buttons / chevron triggers. */
  trailing?: React.ReactNode;
  /** Expanded panel content — render inside a CollapsibleContent. */
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 px-4 min-h-12">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {secondary && (
            <span className="text-xs text-muted-foreground truncate">
              {secondary}
            </span>
          )}
        </div>
        {status && <ConnectionStatusBadge status={status} />}
        {trailing}
      </div>
      {children}
    </div>
  );
}

function ConnectionStatusBadge({
  status,
}: {
  status: "connected" | "configured" | "not-connected";
}) {
  if (status === "not-connected") {
    return <Badge variant="outline">Not connected</Badge>;
  }
  return (
    <Badge variant="secondary">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-positive" />
        {status === "connected" ? "Connected" : "Configured"}
      </span>
    </Badge>
  );
}
