import { notFound } from "next/navigation";
import { getSegmentDetail } from "@/lib/actions/podcast.actions";
import SegmentDetailClient from "@/components/podcasts/SegmentDetailClient";

type Params = { id: string; segmentId: string };

export default async function SegmentDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id, segmentId } = await params;
  const detail = await getSegmentDetail(segmentId);
  if (!detail || detail.podcastId !== id) notFound();
  return <SegmentDetailClient detail={detail} />;
}
