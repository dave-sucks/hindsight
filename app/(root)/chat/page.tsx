import { redirect } from "next/navigation";

// /chat removed — general research chat now lives inside run pages.
export default function ChatPage() {
  redirect("/analysts");
}
