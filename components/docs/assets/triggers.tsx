"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TRIGGER_TYPES, rowLabel } from "@/lib/agent/triggers/condition";
import { TRIGGER_TYPE_DOCS } from "@/lib/docs/trigger-examples";
import { P } from "../doc-text";
import { DocFact } from "../primitives";
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
                  <span className="text-sm font-medium text-foreground">{rowLabel(e.action, true)}</span>
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
