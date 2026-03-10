import { redirect } from "next/navigation";

// /research removed — run history now lives under each analyst detail page.
export default function ResearchPage() {
  redirect("/analysts");
}
