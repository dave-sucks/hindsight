import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// `sizing`: "content" grows with its text (the default); "rows" keeps the
// height its `rows` attribute sets and scrolls inside it, for a long
// document (an agent's instructions on the Agents page).
const textareaVariants = cva(
  "flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      sizing: {
        content: "field-sizing-content",
        rows: "field-sizing-fixed",
      },
    },
    defaultVariants: {
      sizing: "content",
    },
  }
)

function Textarea({
  className,
  sizing,
  ...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ sizing }), className)}
      {...props}
    />
  )
}

export { Textarea }
