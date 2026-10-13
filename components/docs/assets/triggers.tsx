"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TRIGGER_TYPES, actionLabel } from "@/lib/agent/triggers/condition";
import { TRIGGER_TYPE_DOCS } from "@/lib/docs/trigger-examples";
import { P } from "../doc-text";
import { DocFact } from "../primitives";
import { TriggerLog } from "../concept-cards";
import { ExamplePill } from "../trigger-bits";


/** The five kinds as tabs, each with real examples and how it is checked. */
export function TriggerKinds() {
  return (
    <Tabs defaultValue="price">
      <TabsList width="full">
        {TRIGGER_TYPES.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {TRIGGER_TYPE_DOCS.map((t) => (
        <TabsContent key={t.type} value={t.type}>
          <div className="flex flex-col gap-5 pt-5">
            <P>{t.blurb}</P>
            {t.examples.map((e, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{actionLabel(e.action, true)}</span>
                  <ExamplePill spec={e} index={i} />
                </div>
                <P>{e.why}</P>
              </div>
            ))}
            <DocFact label="How it's checked">{t.checked}</DocFact>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** The live trigger log, in the same soft card as the Triggers card on the docs home. */
export function TriggerLogCard() {
  return (
    <div className="h-72 rounded-lg bg-muted/50 p-5" aria-hidden>
      <TriggerLog />
    </div>
  );
}
