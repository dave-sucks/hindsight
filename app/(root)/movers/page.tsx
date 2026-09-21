import { redirect } from "next/navigation";

/** Movers is a tab on /market now. */
export default function MoversPage() {
  redirect("/market?tab=movers");
}
