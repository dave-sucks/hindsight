import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage } from "@/components/docs/doc-page";
import { docBySlug } from "@/components/docs/registry";
import { buildSetupList, buildToolCatalog } from "@/lib/docs/tool-catalog";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = docBySlug(slug);
  return { title: doc ? `${doc.title} · Hindsight Docs` : "Docs · Hindsight" };
}

export default async function DocSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!docBySlug(slug)) notFound();
  return <DocPage slug={slug} tools={buildToolCatalog()} setups={buildSetupList()} />;
}
