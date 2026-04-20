"use client";

import { useState, useCallback, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AgentChat } from "@/components/agent/AgentChat";
import { AnalystConfigPanel } from "@/components/analysts/AnalystConfigPanel";
import { resetAnalystIntelligence } from "@/lib/actions/analyst.actions";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

export function AnalystEditClient({
  analystId,
  analystName,
  currentConfig,
  initialMessage,
}: {
  analystId: string;
  analystName: string;
  currentConfig: Record<string, unknown>;
  initialMessage?: string;
}) {
  // Panel hidden until AI suggests changes (same behavior as builder)
  const [configData, setConfigData] = useState<AgentConfigData | null>(null);
  const [confirmHandler, setConfirmHandler] = useState<(() => void) | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [isResetting, startReset] = useTransition();

  const handleConfigSuggested = useCallback(
    (config: AgentConfigData, onConfirm: () => void) => {
      setConfigData(config);
      setConfirmHandler(() => onConfirm);
    },
    []
  );

  const handleApplyingChange = useCallback((applying: boolean) => {
    setIsApplying(applying);
  }, []);

  const panelOpen = configData !== null;

  const handleReset = useCallback(() => {
    startReset(async () => {
      try {
        const result = await resetAnalystIntelligence(analystId);
        const sectorChanged =
          result.sectorsBefore.join("|") !== result.sectorsAfter.join("|");
        const industryChanged =
          result.industriesBefore.join("|") !== result.industriesAfter.join("|");
        const themeChanged =
          result.themesBefore.join("|") !== result.themesAfter.join("|");
        const changed = [
          sectorChanged && "sectors",
          industryChanged && "industries",
          themeChanged && "themes",
        ].filter(Boolean) as string[];
        toast.success(
          `Reset complete — ${result.monitorsDeleted} monitor${result.monitorsDeleted === 1 ? "" : "s"} cleared` +
            (changed.length > 0 ? `, normalized ${changed.join(", ")}` : ""),
        );
        setResetOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reset failed");
      }
    });
  }, [analystId]);

  return (
    <div className="relative h-[calc(100dvh-3rem)] overflow-hidden">
      {/* Back button + reset (danger) */}
      <div className="absolute top-2 left-3 z-20 flex items-center gap-1">
        <Button variant="ghost" size="icon" render={<Link href={`/analysts/${analystId}`} />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setResetOpen(true)}
          className="text-xs text-muted-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset intelligence
        </Button>
      </div>

      {/* Split layout — chat shrinks, panel grows (same as builder) */}
      <div className="h-full flex">
        {/* Chat side — shrinks smoothly when panel opens */}
        <div
          className="min-h-0 transition-all duration-500 ease-out"
          style={{ flex: panelOpen ? "0 0 55%" : "1 1 100%" }}
        >
          <AgentChat
            mode="editor"
            analystId={analystId}
            currentConfig={currentConfig}
            initialPrompt={initialMessage}
            onConfigSuggested={handleConfigSuggested}
            onMutatingChange={handleApplyingChange}
          />
        </div>

        {/* Config panel — grows in from right when AI suggests changes */}
        <div
          className="min-h-0 transition-all duration-500 ease-out overflow-hidden"
          style={{
            flex: panelOpen ? "0 0 45%" : "0 0 0%",
            opacity: panelOpen ? 1 : 0,
          }}
        >
          <div className="h-full p-3 pl-0">
            {configData && (
              <AnalystConfigPanel
                config={configData}
                onConfirm={confirmHandler ?? (() => {})}
                isCreating={isApplying}
                confirmLabel="Apply Changes"
                confirmingLabel="Applying..."
              />
            )}
          </div>
        </div>
      </div>

      {/* Reset confirmation — danger action, wipes auto-generated monitors +
          re-normalizes universe values. Historical runs/theses are untouched. */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset {analystName}&apos;s intelligence?</DialogTitle>
            <DialogDescription>
              This will delete every auto-generated monitor (Builder + Briefing
              agent origin), re-run canonical normalizers against stored
              sectors, industries, themes, and the exclusion list, and leave
              all runs, theses, trades, and user-created monitors intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResetOpen(false)}
              disabled={isResetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReset}
              disabled={isResetting}
              className="gap-2"
            >
              {isResetting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isResetting ? "Resetting…" : "Reset intelligence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
