import { notFound } from "next/navigation";
import { getPodcastDetail } from "@/lib/actions/podcast.actions";
import PodcastDetailClient from "@/components/podcasts/PodcastDetailClient";

type Params = { id: string };

export default async function PodcastDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const detail = await getPodcastDetail(id);
  if (!detail) notFound();
  return <PodcastDetailClient detail={detail} />;
}
