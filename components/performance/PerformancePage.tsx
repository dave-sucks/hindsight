'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TradingTab } from '@/components/performance/TradingTab';
import { AgentWorkTab } from '@/components/performance/AgentWorkTab';
import { SystemHealthSection } from '@/components/performance/SystemHealthSection';

/** /performance: how the closed trades did (Trading), and what the agents were shown and did (Agent work). */
export default function PerformancePage() {
  return (
    <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">Performance</h1>
      <Tabs defaultValue="trading">
        <TabsList>
          <TabsTrigger value="trading">Trading</TabsTrigger>
          <TabsTrigger value="agent-work">Agent work</TabsTrigger>
        </TabsList>
        <TabsContent value="trading">
          <TradingTab />
        </TabsContent>
        <TabsContent value="agent-work">
          <div className="space-y-6">
            <AgentWorkTab />
            {/* How the machine ran: the Alpaca ↔ DB sync, tool usage, recent runs. */}
            <SystemHealthSection />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
