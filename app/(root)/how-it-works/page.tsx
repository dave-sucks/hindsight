import { Suspense } from "react";
import type { Metadata } from "next";
import { DocsHome } from "@/components/docs/docs-home";
import { buildFrameworkData } from "@/lib/docs/framework";
import { loadGuide } from "@/lib/docs/guide";
import { buildSetupList, buildToolCatalog } from "@/lib/docs/tool-catalog";

export const metadata: Metadata = { title: "How it works · Hindsight" };

/** The tour: the story of one stock, the concept cards and the tools, each opening a doc in a sheet. */
export default function HowItWorksPage() {
  // Which agent has which tool, and what each is sent, are read from the code here, on the server.
  return (
    <Suspense>
      <DocsHome tools={buildToolCatalog()} setups={buildSetupList()} guide={loadGuide()} framework={buildFrameworkData()} />
    </Suspense>
  );
}
