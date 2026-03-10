import { redirect } from "next/navigation";

// /research/runs/[id] is the old URL — canonical URL is now /runs/[id].
export default async function OldRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/runs/${id}`);
}
