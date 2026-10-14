import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DocsHub, OVERVIEW } from "@/components/docs/docs-hub";
import { loadGuide } from "@/lib/docs/guide";
import { buildSetupList, buildToolCatalog } from "@/lib/docs/tool-catalog";

export const metadata: Metadata = { title: "Docs · Hindsight" };

/** The docs hub, opened on the Overview (docs/guide/README.md). */
export default async function DocsPage({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  // Links from before the hub opened a doc as /docs?doc=<slug>.
  const { doc } = await searchParams;
  if (doc) redirect(`/docs/${doc}`);
  return <DocsHub slug={OVERVIEW} tools={buildToolCatalog()} setups={buildSetupList()} guide={loadGuide()} />;
}
