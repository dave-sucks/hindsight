import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DocsHub, HOME } from "@/components/docs/docs-hub";
import { buildFrameworkData } from "@/lib/docs/framework";
import { loadGuide } from "@/lib/docs/guide";
import { buildSetupList, buildToolCatalog } from "@/lib/docs/tool-catalog";

export const metadata: Metadata = { title: "Docs · Hindsight" };

/** The docs front door: where to start, the agents and the concepts as cards. */
export default async function DocsPage({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  // Links from before the hub opened a doc as /docs?doc=<slug>.
  const { doc } = await searchParams;
  if (doc) redirect(`/docs/${doc}`);
  return <DocsHub slug={HOME} tools={buildToolCatalog()} setups={buildSetupList()} guide={loadGuide()} framework={buildFrameworkData()} />;
}
