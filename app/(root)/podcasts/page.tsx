import { getPodcastList } from "@/lib/actions/podcast.actions";
import PodcastsPageClient from "@/components/podcasts/PodcastsPageClient";

export default async function PodcastsPage() {
  const podcasts = await getPodcastList();
  return <PodcastsPageClient podcasts={podcasts} />;
}
