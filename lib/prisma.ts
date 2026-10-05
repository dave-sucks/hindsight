import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { toStoredTriggers, viewTriggers } from './agent/triggers/condition/stored'

/**
 * Trigger lists are stored in the condition shape (docs/plans/TRIGGER_TYPES.md
 * §9). Every write of `triggers` on a thesis, an analyst or the account is
 * turned into it here, and every read comes back in the kinds' spelling the
 * app still speaks until the agents' tools and prompts move to the shape. One
 * place, so no write path can store a kind and no read can miss the view.
 */
/** A write's args with every `triggers` value it carries stored in the condition shape. */
export function storeTriggersIn<A>(args: A): A {
  const a = args as Record<string, unknown>
  const fix = (data: unknown): unknown => {
    if (Array.isArray(data)) return data.map(fix)
    if (!data || typeof data !== 'object' || !('triggers' in data)) return data
    return { ...data, triggers: toStoredTriggers((data as { triggers: unknown }).triggers) }
  }
  const out: Record<string, unknown> = { ...a }
  for (const key of ['data', 'create', 'update'] as const) if (key in a) out[key] = fix(a[key])
  return out as A
}

const WRITES: ReadonlySet<string> = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert'])

export function storeAndViewTriggers(base: PrismaClient) {
  const view = { triggers: { needs: { triggers: true }, compute: (row: { triggers: unknown }) => viewTriggers(row.triggers) } } as const
  return base.$extends({
    query: {
      thesis: { $allOperations: ({ operation, args, query }) => query(WRITES.has(operation) ? storeTriggersIn(args) : args) },
      agentConfig: { $allOperations: ({ operation, args, query }) => query(WRITES.has(operation) ? storeTriggersIn(args) : args) },
      account: { $allOperations: ({ operation, args, query }) => query(WRITES.has(operation) ? storeTriggersIn(args) : args) },
    },
    result: { thesis: view, agentConfig: view, account: view },
  })
}

function makePrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  return new PrismaClient({ adapter })
}

const globalForPrisma = globalThis as unknown as {
  prismaRaw?: PrismaClient
  prisma?: ReturnType<typeof storeAndViewTriggers>
}

/** The client without the trigger view: what is really stored. For the shape backfill and its down script only. */
export const prismaRaw = globalForPrisma.prismaRaw ?? makePrismaClient()

export const prisma = globalForPrisma.prisma ?? storeAndViewTriggers(prismaRaw)

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaRaw = prismaRaw
  globalForPrisma.prisma = prisma
}
