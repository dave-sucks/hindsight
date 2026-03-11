"use client";

import { cn } from "@/lib/utils";

export function UserMessage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex justify-end", className)}>
      <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5 max-w-[80%]">
        <p className="text-sm leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
