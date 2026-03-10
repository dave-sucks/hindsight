import { redirect } from "next/navigation";

// /research/history removed — run history now lives under each analyst detail page.
export default function ResearchHistoryPage() {
  redirect("/analysts");
}
