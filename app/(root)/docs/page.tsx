import { Suspense } from "react";
import type { Metadata } from "next";
import { DocsHome } from "@/components/docs/docs-home";
import { buildSetupList, buildToolCatalog } from "@/lib/docs/tool-catalog";

export const metadata: Metadata = { title: "Docs · Hindsight" };

export default function DocsPage() {
  // Which agent has which tool is read from lib/agent/modes.ts here, on the server.
  const tools = buildToolCatalog();
  return (
    <Suspense>
      <DocsHome tools={tools} setups={buildSetupList()} />
    </Suspense>
  );
}
