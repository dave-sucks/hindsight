/**
 * Manually fire the domain-monitor Inngest event from the command line.
 *
 * Usage (from repo root):
 *   npx tsx scripts/trigger-domain-monitor.ts
 *
 * Requires INNGEST_EVENT_KEY in your environment (or .env.local).
 * The event hits your local Inngest dev server by default.
 * For production, set INNGEST_BASE_URL=https://inn.gs
 */

import { Inngest } from "inngest"
import * as dotenv from "dotenv"
import * as path from "path"

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })

const eventKey = process.env.INNGEST_EVENT_KEY
if (!eventKey) {
  console.error("ERROR: INNGEST_EVENT_KEY is not set in environment / .env.local")
  process.exit(1)
}

const client = new Inngest({
  id: "hindsight",
  eventKey,
  baseUrl: process.env.INNGEST_BASE_URL ?? "http://localhost:8288",
})

async function main() {
  console.log("Sending intelligence/domain-monitor event…")
  const result = await client.send({ name: "intelligence/domain-monitor", data: {} })
  console.log("Sent:", result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
