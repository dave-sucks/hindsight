import { redirect } from "next/navigation";

/** The old "How Hindsight Works" page moved to /docs. */
export default function AgentWorkflowPage() {
  redirect("/docs");
}
