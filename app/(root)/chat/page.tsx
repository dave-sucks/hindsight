"use client";

import { ChatEntryComposer } from "@/components/assistant-ui/chat-entry-composer";
import { BarChart3, Globe, TrendingUp } from "lucide-react";

export default function ChatPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold">Hindsight</h1>
          <p className="text-sm text-muted-foreground">
            Ask anything. Research stocks, analyze trades, or update your strategy.
          </p>
        </div>

        <ChatEntryComposer
          targetUrl="/analysts/new"
          tooltip={{
            content: "Type a ticker, question, or /command to get started",
            storageKey: "chat-entry",
          }}
          features={{
            tickerSearch: true,
            slashCommands: true,
            plusMenu: true,
            placeholder: "Ask anything or type / for commands…",
            integrations: [
              {
                label: "Market data",
                icon: BarChart3,
                enabled: true,
                description: "Finnhub live quotes & news",
              },
              {
                label: "Web search",
                icon: Globe,
                enabled: true,
                description: "Perplexity Sonar",
              },
              {
                label: "Alpaca paper trading",
                icon: TrendingUp,
                enabled: true,
                description: "Paper trade execution",
              },
            ],
          }}
        />
      </div>
    </div>
  );
}
