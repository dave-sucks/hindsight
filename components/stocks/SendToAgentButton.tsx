"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SendToAgentIcon } from "@/components/ui/send-to-agent-icon";
import { sendToThesisWriter } from "@/lib/actions/watchlist.actions";

// ─── SendToAgentButton ───────────────────────────────────────────────────
// Hand this name to the thesis writer. Lives in the header icon strip
// beside the pin, because it is the same kind of thing: one action on this
// stock, always in the same place.
//
// Until now only agents and the promote dialog could dispatch research, so
// there was no way to say "go look at this" by hand. The result comes back
// on the horizon's own review schedule, which is what turns a plain watch
// into an Agent Watch.

/** The send itself, shared by the button and the header's menu item. */
export function useSendToAgent(analystId: string, ticker: string, thesisId: string, onSent?: () => void) {
  const [pending, setPending] = useState(false);
  const send = () => {
    setPending(true);
    sendToThesisWriter(analystId, ticker, "horizon", "refresh", thesisId)
      .then(() => {
        toast.success(`${ticker} sent to the agent — it lands shortly.`);
        onSent?.();
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : `Couldn't send ${ticker}`))
      .finally(() => setPending(false));
  };
  return { pending, send };
}

export function SendToAgentButton({
  analystId,
  ticker,
  thesisId,
  size = "icon-sm",
  onSent,
}: {
  analystId: string;
  ticker: string;
  thesisId: string;
  size?: "icon-sm" | "icon";
  onSent?: () => void;
}) {
  const { pending, send } = useSendToAgent(analystId, ticker, thesisId, onSent);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label={`Send ${ticker} to the agent`}
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              send();
            }}
          />
        }
      >
        <SendToAgentIcon />
      </TooltipTrigger>
      <TooltipContent side="bottom">Send to Agent</TooltipContent>
    </Tooltip>
  );
}
