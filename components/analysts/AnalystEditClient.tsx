"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalystEditorChatWithInitial } from "@/components/analysts/AnalystEditorChatWithInitial";
import { AnalystConfigPanel } from "@/components/analysts/AnalystConfigPanel";
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
  // Start with current config in the panel (always visible for edit)
  const [configData, setConfigData] = useState<AgentConfigData>(
    currentConfig as unknown as AgentConfigData
  );
  const [confirmHandler, setConfirmHandler] = useState<(() => void) | null>(null);
  const [isApplying, setIsApplying] = useState(false);

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

  return (
    <div className="relative h-[calc(100dvh-3rem)] overflow-hidden">
      {/* Back button */}
      <div className="absolute top-2 left-3 z-20">
        <Button variant="ghost" size="icon" render={<Link href={`/analysts/${analystId}`} />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* 2-panel layout — same as builder */}
      <div className="h-full flex">
        {/* Chat side */}
        <div
          className="min-h-0 transition-all duration-500 ease-out"
          style={{ flex: "0 0 55%" }}
        >
          <AnalystEditorChatWithInitial
            analystId={analystId}
            currentConfig={currentConfig}
            initialMessage={initialMessage}
            onConfigSuggested={handleConfigSuggested}
            onApplyingChange={handleApplyingChange}
          />
        </div>

        {/* Config panel — always visible for edit (shows current config) */}
        <div
          className="min-h-0 overflow-hidden"
          style={{ flex: "0 0 45%" }}
        >
          <div className="h-full p-3 pl-0">
            <AnalystConfigPanel
              config={configData}
              onConfirm={confirmHandler ?? (() => {})}
              isCreating={isApplying}
              confirmLabel="Apply Changes"
              confirmingLabel="Applying..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
