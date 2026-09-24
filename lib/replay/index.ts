/**
 * The replay harness (DAV-311) — run a tool's real entry point against
 * production-shaped rows. See replay.ts for why it exists.
 */
export { replayTool, type Replay, type ReplayOptions, type ReplayResult } from "@/lib/replay/replay";
export { prismaDouble, type PrismaDouble, type Row, type StoreSeed } from "@/lib/replay/prisma-double";
export {
  thesisRow,
  positionRow,
  thesisUpdateRow,
  agentConfigRow,
  accountRow,
  daysAgo,
  REPLAY_ACCOUNT_ID,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
  REPLAY_USER_ID,
} from "@/lib/replay/rows";
