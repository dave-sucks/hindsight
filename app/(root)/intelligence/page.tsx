import { redirect } from "next/navigation";

/**
 * The intelligence page is gone. Its findings are the Signals tab on
 * /market; its health panels moved to /performance.
 */
export default function IntelligencePage() {
  redirect("/market?tab=signals");
}
