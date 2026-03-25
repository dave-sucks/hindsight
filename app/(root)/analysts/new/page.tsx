"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="relative h-[calc(100dvh-5.25rem)] overflow-hidden">
      {/* Floating ghost buttons — no background, over the chat */}
      <div className="absolute top-2 left-3 z-20">
        <Button variant="ghost" size="icon" render={<Link href="/analysts" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>
      <div className="absolute top-2 right-3 z-20">
        <HowItWorksSheet flow="analyst-builder">
          <Sparkles className="h-4 w-4" />
        </HowItWorksSheet>
      </div>

      {/* Full layout */}
      <div className="h-full flex relative">
        {/* Chat side */}
        <div
          className="min-h-0 transition-all duration-500 ease-out"
          style={{ flex: panelOpen ? "1 1 0%" : "1 1 100%" }}
        >
          <AnalystBuilderChat
            onConfigSuggested={handleConfigSuggested}
            onCreatingChange={handleCreatingChange}
          />
        </div>

        {/* Floating config panel — Manus-style artifact */}
        {configData && (
          <div
            className="absolute inset-4 left-auto z-10 w-[440px] max-w-[45%] transition-all duration-500 ease-out"
            style={{
              opacity: panelOpen ? 1 : 0,
              transform: panelOpen ? "translateX(0)" : "translateX(100%)",
            }}
          >
            <AnalystConfigPanel
              config={configData}
              onConfirm={confirmHandler ?? (() => {})}
              isCreating={isCreating}
            />
          </div>
        )}
      </div>
    </div>
  );
}
