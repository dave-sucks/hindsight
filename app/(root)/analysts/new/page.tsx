import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { AnalystBuilderChat } from "@/components/analysts/AnalystBuilderChat";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";

export default function NewAnalystPage() {
  return (
    <div className="flex flex-col h-[calc(100dvh-5.25rem)] overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-3 flex items-center gap-3 shrink-0">
        <Link
          href="/analysts"
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -ml-1"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-sm font-medium">New Analyst</span>
        <div className="ml-auto">
          <HowItWorksSheet flow="analyst-builder">
            <Sparkles className="h-3 w-3" />
            How it works
          </HowItWorksSheet>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 min-h-0">
        <AnalystBuilderChat />
      </div>
    </div>
  );
}
