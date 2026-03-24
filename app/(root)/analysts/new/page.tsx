"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { AnalystBuilderChat } from "@/components/analysts/AnalystBuilderChat";
import { AnalystConfigPanel } from "@/components/analysts/AnalystConfigPanel";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

export default function NewAnalystPage() {
  const [configData, setConfigData] = useState<AgentConfigData | null>(null);
  const [confirmHandler, setConfirmHandler] = useState<
    (() => void) | null
  >(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleConfigSuggested = useCallback(
    (config: AgentConfigData, onConfirm: () => void) => {
      setConfigData(config);
      setConfirmHandler(() => onConfirm);
    },
    []
  );

  const handleCreatingChange = useCallback((creating: boolean) => {
    setIsCreating(creating);
  }, []);

  const panelOpen = configData !== null;

  return (
    <div className="flex flex-col h-[calc(100dvh-5.25rem)] overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-3 flex items-center gap-3 shrink-0">
        <Link
          href="/analysts"
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -ml-1"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-sm font-medium">New Analyst</span>
        <div className="ml-auto">
          <HowItWorksSheet flow="analyst-builder">
            <Sparkles className="h-4 w-4" />
          </HowItWorksSheet>
        </div>
      </div>

      {/* Split pane */}
      <div className="flex-1 min-h-0 flex">
        {/* Chat side */}
        <div
          className="min-h-0 transition-all duration-300 ease-out"
          style={{ flex: panelOpen ? "0 0 55%" : "1 1 100%" }}
        >
          <AnalystBuilderChat
            onConfigSuggested={handleConfigSuggested}
            onCreatingChange={handleCreatingChange}
          />
        </div>

        {/* Config panel side */}
        <div
          className="min-h-0 overflow-hidden transition-all duration-300 ease-out"
          style={{
            flex: panelOpen ? "0 0 45%" : "0 0 0%",
            opacity: panelOpen ? 1 : 0,
          }}
        >
          {configData && (
            <AnalystConfigPanel
              config={configData}
              onConfirm={confirmHandler ?? (() => {})}
              isCreating={isCreating}
            />
          )}
        </div>
      </div>
    </div>
  );
}
