/**
 * A section of a settings sheet: its label, an optional tooltip, and its
 * rows. The analyst's Settings sheet, the podcast sheets and the Agents page
 * share it, so their sections read the same. Its own file so a page can use
 * it without the whole analyst form (AnalystConfigForm re-exports it).
 */
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Section({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 border-b last:border-b-0 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium">{label}</p>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help" />}>
              <Info className="h-3 w-3 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}
