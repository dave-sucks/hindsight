import type { Metadata } from "next";
import { FrameworkPage } from "@/components/docs/framework/framework-page";
import { buildFrameworkData } from "@/lib/docs/framework";

export const metadata: Metadata = { title: "The Framework · Docs · Hindsight" };

export default function DocsFrameworkPage() {
  // Every prompt and tool menu is built and measured here, on the server.
  return <FrameworkPage data={buildFrameworkData()} />;
}
