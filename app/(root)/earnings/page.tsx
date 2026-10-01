import { redirect } from "next/navigation";

/** Earnings is a tab on /market now. */
export default function EarningsPage() {
  redirect("/market?tab=earnings");
}
