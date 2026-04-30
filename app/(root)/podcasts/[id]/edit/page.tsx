import { notFound } from "next/navigation";
import { getPodcastDetail } from "@/lib/actions/podcast.actions";
import { PodcastEditClient } from "@/components/podcasts/PodcastEditClient";

type Params = { id: string };

export default async function PodcastEditPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ message?: string }>;
}) {
  const { id } = await params;
  const { message } = await searchParams;

  const detail = await getPodcastDetail(id);
  if (!detail) return notFound();

  return (
    <PodcastEditClient detail={detail} initialMessage={message} />
  );
}
