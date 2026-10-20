import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsHub, OVERVIEW } from "@/components/docs/docs-hub";
import { docBySlug } from "@/components/docs/registry";
import { buildFrameworkData } from "@/lib/docs/framework";
import { loadGuide } from "@/lib/docs/guide";
import { buildSetupList, buildToolCatalog } from "@/lib/docs/tool-catalog";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = slug === "overview" ? { title: "Overview" } : docBySlug(slug);
  return { title: doc ? `${doc.title} · Hindsight Docs` : "Docs · Hindsight" };
}

export default async function DocSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // The Overview is the guide's README, /docs/overview.
  const doc = slug === "overview" ? OVERVIEW : docBySlug(slug)?.slug;
  if (!doc) notFound();
  return <DocsHub slug={doc} tools={buildToolCatalog()} setups={buildSetupList()} guide={loadGuide()} framework={buildFrameworkData()} />;
}
