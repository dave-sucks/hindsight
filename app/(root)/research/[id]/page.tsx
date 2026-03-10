import { redirect } from "next/navigation";

// /research/[id] (thesis detail) removed — trades live at /trades.
export default function ThesisDetailPage() {
  redirect("/trades");
}
