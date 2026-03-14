import { redirect } from "next/navigation";

// Analyst creation now happens through the agent flow.
// Redirect to the analysts list.
export default function NewAnalystPage() {
  redirect("/analysts");
}
