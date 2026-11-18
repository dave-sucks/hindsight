import type { Metadata } from "next";
import { FrameworkPage } from "@/components/docs/framework/framework-page";
import { loadFrameworkData } from "@/lib/docs/framework";

export const metadata: Metadata = { title: "The Framework · Docs · Hindsight" };

export default async function DocsFrameworkPage() {
  // Every agent is read from its record and sized on its latest saved run here, on the server.
  return <FrameworkPage data={await loadFrameworkData()} />;
}
