import { NextRequest, NextResponse } from "next/server"
import { inngest } from "@/lib/inngest/client"

// POST /api/intelligence/trigger — manually trigger an intelligence job
// Body: { job: "market-sweep" | "portfolio-monitor" | "source-pack-monitor" | "signal-router" | "morning-brief" }

const JOB_EVENTS: Record<string, string> = {
  "market-sweep": "intelligence/market-sweep",
  "portfolio-monitor": "intelligence/portfolio-monitor",
  "source-pack-monitor": "intelligence/source-pack-monitor",
  "signal-router": "intelligence/signal-router",
  "morning-brief": "intelligence/morning-brief",
}

export async function POST(req: NextRequest) {
  const { job } = (await req.json()) as { job?: string }

  if (!job || !JOB_EVENTS[job]) {
    return NextResponse.json(
      { error: `Invalid job. Valid options: ${Object.keys(JOB_EVENTS).join(", ")}` },
      { status: 400 }
    )
  }

  const eventName = JOB_EVENTS[job]

  await inngest.send({ name: eventName, data: {} })

  return NextResponse.json({ triggered: job, event: eventName })
}
