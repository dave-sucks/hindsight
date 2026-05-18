# Team Access Plan — Account-based multi-user model

**Status:** Design ready, not started  
**PR target:** Single PR, many commits  
**Migration risk:** LOW — near-clean-slate. One owner, one test account to delete.

---

## Mental model

```
Account
  └── AgentConfig (accountId)
  └── Thesis       (accountId)
  └── Position     (accountId)
  └── ResearchRun  (accountId)
  └── ... all data entities

User ──── AccountMembership ──── Account
           (role: OWNER | EDITOR | VIEWER)
```

- **Account** owns all data. Every entity scopes to `accountId`, not `userId`.
- **User** is the person who logs in (Supabase auth mirror). A user belongs to an account via `AccountMembership`.
- **AccountMembership** is the join table — `userId + accountId + role`.
- On signup, we auto-create one Account + one OWNER membership for the new user.
- On invite acceptance, we create an EDITOR or VIEWER membership for an existing/new user on the inviter's account.

---

## Schema changes

### 1. New `Account` model

```prisma
model Account {
  id        String   @id @default(cuid())
  name      String                         // display name, e.g. "Dave's Account"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 2. New `AccountMembership` model

```prisma
model AccountMembership {
  id        String     @id @default(cuid())
  accountId String
  userId    String
  role      MemberRole @default(VIEWER)
  createdAt DateTime   @default(now())

  @@unique([accountId, userId])
  @@index([userId])                       // "which accounts does this user belong to?"
  @@index([accountId])                    // "who are the members of this account?"
}

enum MemberRole {
  OWNER    // full access + team management
  EDITOR   // full access, cannot manage team
  VIEWER   // read-only
}
```

### 3. New `AccountInvite` model

```prisma
model AccountInvite {
  id         String     @id @default(cuid())
  accountId  String
  email      String
  role       MemberRole @default(VIEWER)
  token      String     @unique @default(cuid())
  expiresAt  DateTime                        // now() + 7 days on creation
  acceptedAt DateTime?
  createdAt  DateTime   @default(now())

  @@index([accountId])
  @@index([token])
}
```

### 4. Add `accountId` to every data model

Replace `userId` with `accountId` as the primary scope field on all data models below.
**Exception:** keep `userId` on `Position` and `TradeDecision` as a `placedByUserId` audit field (which team member triggered the trade). Keep `userId` as-is on `UserApiKey` (API keys are per-person, not per-account).

Models to update (add `accountId String`, drop `userId` as scope or rename to `placedByUserId`):

```
AgentConfig
ResearchRun
Thesis
WatchlistItem
AnalystWatchlistItem
Monitor
MorningBrief
AnalystBriefing
AccuracyReport
Podcast
PodcastSegment
PodcastSegmentBriefing
Episode
SegmentTranscript
```

Models that keep `userId` but also get `accountId`:
```
Position       — add accountId (scope); rename userId → placedByUserId (audit)
TradeDecision  — add accountId (scope); rename userId → placedByUserId (audit)
```

Models that keep `userId` only (no accountId needed):
```
UserApiKey     — API keys are per-person
```

Update all `@@index([userId])` to `@@index([accountId])` on the models above.

---

## Migration steps (Prisma migration file)

The migration file should do this in order:

```sql
-- 1. Create Account table (done by Prisma via schema change)

-- 2. Create one Account per existing User
INSERT INTO "Account" (id, name, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u.email,                  -- use email as initial display name
  NOW(),
  NOW()
FROM "User" u;

-- 3. Create OWNER membership for each user → their new account
-- (Requires a temp join — match user to the account we just created for them)
-- Easiest: do this in application code after migration, not raw SQL.
-- See "Seeding memberships" note below.

-- 4. Backfill accountId on all data models from userId
-- e.g. for AgentConfig:
UPDATE "AgentConfig" ac
SET "accountId" = am.id
FROM "AccountMembership" am
JOIN "Account" a ON a.id = am."accountId"
WHERE am."userId" = ac."userId"
  AND am.role = 'OWNER';
-- Repeat for every model listed above.

-- 5. Add NOT NULL constraint on accountId after backfill
-- 6. Drop userId columns that were replaced (after verifying backfill)
```

**Seeding memberships note:** The mapping from userId → new accountId needs to be deterministic. Simplest approach: in the migration, create accounts with `id = cuid_from_userid` (or use a temp table). Better: write a short Node.js seed script (`prisma/seed-accounts.ts`) that runs after `migrate deploy`. The implementation session should decide which is cleaner — both work.

---

## `getAccountId` utility (new file)

**`lib/auth/account.ts`** — replaces the old `effective-user.ts` concept.

```ts
import { prisma } from "@/lib/prisma";

/**
 * Returns the accountId for the current session user.
 * For an owner: their own account.
 * For a member: the account they were invited to.
 * If a user belongs to multiple accounts (future), this returns
 * the "active" account stored in the session cookie — not implemented yet,
 * so for now it returns the first membership found (OWNER preferred).
 */
export async function getAccountId(userId: string): Promise<string | null> {
  // Prefer OWNER membership (their own account)
  const owner = await prisma.accountMembership.findFirst({
    where: { userId, role: "OWNER" },
    select: { accountId: true },
  });
  if (owner) return owner.accountId;

  // Fall back to any membership (EDITOR or VIEWER)
  const member = await prisma.accountMembership.findFirst({
    where: { userId },
    select: { accountId: true },
  });
  return member?.accountId ?? null;
}

/**
 * Returns the role the current user has on the given account.
 * Used by write routes to gate EDITOR-only and OWNER-only actions.
 */
export async function getUserRole(
  userId: string,
  accountId: string,
): Promise<MemberRole | null> {
  const m = await prisma.accountMembership.findUnique({
    where: { accountId_userId: { accountId, userId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

type MemberRole = "OWNER" | "EDITOR" | "VIEWER";
```

---

## Route migration pattern

Every API route currently does:
```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) return new Response("Unauthorized", { status: 401 });
const userId = user.id;
// then: prisma.something.findMany({ where: { userId } })
```

Change to:
```ts
import { getAccountId, getUserRole } from "@/lib/auth/account";

const { data: { user } } = await supabase.auth.getUser();
if (!user) return new Response("Unauthorized", { status: 401 });

const accountId = await getAccountId(user.id);
if (!accountId) return new Response("No account", { status: 403 });

// then: prisma.something.findMany({ where: { accountId } })

// For write routes — gate VIEWER role:
// const role = await getUserRole(user.id, accountId);
// if (role === "VIEWER") return new Response("Forbidden", { status: 403 });
```

### Routes to update (15 files)

```
app/api/agent/[mode]/route.ts
app/api/research/agent-run/route.ts
app/api/research/trigger/route.ts
app/api/intelligence/monitors/route.ts
app/api/intelligence/health/route.ts
app/api/intelligence/signals/route.ts
app/api/intelligence/sync-health/route.ts
app/api/intelligence/coverage/route.ts
app/api/intelligence/briefs/route.ts
app/api/theses/[id]/updates/route.ts
app/api/theses/[id]/triggers/route.ts
app/api/admin/triggers/fire/route.ts
app/api/analysts/[id]/routing-stats/route.ts
app/api/agent-activity/route.ts
app/api/universe/validate-fence/route.ts
```

VIEWER gate applies to: `agent-run`, `research/trigger`, `admin/triggers/fire`.  
Read-only routes (signals, briefs, activity, theses): no gate, all roles can read.

### Inngest cron functions

Crons query `AgentConfig` directly from DB — no session. They already query by a scoped field. Update them to filter by `accountId` instead of `userId`:

```ts
// Before:
prisma.agentConfig.findMany({ where: { enabled: true } })
// After (no change needed for the cron itself — it processes all accounts)
// BUT when the cron builds context (getUserEmail, etc.), resolve via accountId:
const membership = await prisma.accountMembership.findFirst({
  where: { accountId: config.accountId, role: "OWNER" },
  select: { userId: true },
});
const email = await getUserEmail(membership.userId);
```

Check `morning-research.ts`, `discovery-run.ts`, `price-monitor.ts`, `weekly-digest.ts`, `accuracy-scorer.ts` for `userId` references — replace with `accountId` where used for data scoping, and the membership lookup above where used to resolve the owner's email.

### Server components (app router pages)

Pages that do `supabase.auth.getUser()` and pass `userId` to child components or server queries need the same `getAccountId()` swap. Grep for `user.id` in `app/(root)/` to find them.

---

## Signup flow change

When a new user signs up (Supabase auth callback), the app must create:
1. An `Account` row (name = email for now, user can rename later)
2. An `AccountMembership` row with `role: "OWNER"`

Find the auth callback route — likely `app/auth/callback/route.ts` or similar. After Supabase confirms the session, add:

```ts
// Check if user already has an account (returning user, edge case)
const existing = await prisma.accountMembership.findFirst({
  where: { userId: user.id },
});
if (!existing) {
  const account = await prisma.account.create({
    data: { name: user.email ?? "My Account" },
  });
  await prisma.accountMembership.create({
    data: { accountId: account.id, userId: user.id, role: "OWNER" },
  });
}
```

---

## New API routes (invite flow)

### `POST /api/settings/team/invite`
```ts
// body: { email: string; role: "VIEWER" | "EDITOR" }
// 1. getAccountId(user.id) — must be OWNER to invite
// 2. Check no existing membership for this email on this account
// 3. Create AccountInvite { accountId, email, role, token, expiresAt: +7d }
// 4. Send invite email (team-invite.ts template)
```

### `GET /api/settings/team/accept?token=xxx`
```ts
// 1. Find AccountInvite by token; reject if expired or accepted
// 2. If Supabase user exists for invite.email → create AccountMembership
// 3. If not → send Supabase magic link with redirectTo pointing back here
// 4. Mark invite acceptedAt = now()
// 5. Redirect to /
```

### `DELETE /api/settings/team/members/[userId]`
```ts
// OWNER only. Delete AccountMembership. User's Supabase account untouched.
```

### `GET /api/settings/team`
```ts
// Returns: active members + pending invites for this account
```

---

## Email template

**`lib/emails/team-invite.ts`** — new file.  
Subject: `You've been invited to Hindsight`  
Body: "{ownerName} invited you to collaborate. Click below to accept."  
CTA → `{APP_URL}/api/settings/team/accept?token={token}`  
Expiry: "Link expires in 7 days."  
Style: match `trade-closed.ts` (dark background, branded).

---

## Settings UI

### `/settings/team` — new page

Two panels using ShadCN Table + Card:

**Members** (columns: Email, Role, Joined, Remove)  
- Remove button → `DELETE /api/settings/team/members/[userId]` → optimistic remove  
- OWNER row has no Remove button

**Invite** (email input + role Select + "Send Invite" button)  
- Below: pending invites table (Email, Role, Expires, Revoke)

### Nav account indicator

If `getUserRole(session.user.id, accountId) !== "OWNER"`, show a small badge in the nav: "Viewing [Account Name]". Fetch account name from `Account.name`.

---

## Role enforcement summary

| Action | OWNER | EDITOR | VIEWER |
|--------|-------|--------|--------|
| View all data | ✅ | ✅ | ✅ |
| Trigger runs / place trades | ✅ | ✅ | ❌ |
| Manage analysts / watchlist | ✅ | ✅ | ❌ |
| Invite / remove members | ✅ | ❌ | ❌ |
| Rename account | ✅ | ❌ | ❌ |

---

## Rollout

1. Delete the second test account from Supabase dashboard
2. `npx prisma migrate dev --name add-account-model`
3. Run seed script to create Account + OWNER membership for Dave's user
4. Backfill `accountId` on all data models
5. Deploy — no behavioral change yet (all queries resolve to same account)
6. Add `getAccountId()` call to all 15 routes — verify nothing breaks
7. Test invite flow end-to-end with a second email
8. Verify VIEWER gets 403 on write routes
9. Verify Inngest crons still process correctly (check morning run logs)

## What NOT to touch

- Supabase auth config — users still sign in the same way
- `UserApiKey` model — stays `userId`-scoped, not `accountId`
- Inngest function IDs or cron schedules
- Any podcast code — out of scope
- `lib/email.ts` — `getUserEmail()` still resolves by userId; just make sure callers pass the OWNER's userId (resolved via membership lookup)
