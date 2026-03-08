import ResearchChat from "@/components/ResearchChat";
import { createClient } from "@/lib/supabase/server";

export default async function ResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Research Chat</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask the AI to research any stock and generate a trade thesis.
        </p>
      </div>
      <ResearchChat userId={user?.id ?? ""} />
    </div>
  );
}
