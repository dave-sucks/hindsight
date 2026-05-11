# Team Access Plan — Multi-user shared-account model

**Status:** Design ready, not started  
**PR target:** Single PR, many commits  
**Migration risk:** LOW — Dave has 2 test accounts and can delete one. No production users to migrate.

---

## What we're building

One account owner (Dave) can invite colleagues as team members. Members log in with their own Supabase credentials but see the owner's analysts, positions, theses, and runs. The owner's `userId` becomes the `effectiveUserId` for all DB queries in any member session.

This is the "shared-account" model, not an org model. One owner, N members. Upgradeable to full org later — the `effectiveUserId` abstraction makes that a swap in one utility file.

---

## Schema additions

Add to `prisma/schema.prisma` at the end of the file, before the closing:

```prisma
model AccountMembership {
  id        String     @id @default(cuid())
  ownerId   String                      // owner's Supabase userId
  memberId  String                      // member's Supabase userId
  role      MemberRole @default(VIEWER)
  createdAt DateTime   @default(now())

  @@unique([ownerId, memberId])
  @@index([memberId])                   // "which account does this user belong to?"
}

model AccountInvite {
  id         String     @id @default(cuid())
  ownerId    String
  email      String                     // invited email address
  role       MemberRole @default(VIEWER)
  token      String     @unique @default(cuid())
  expiresAt  DateTime                   // set to now() + 7 days on creation
  acceptedAt DateTime?
  createdAt  DateTime   @default(now())

  @@index([ownerId])
  @@index([token])
}

enum MemberRole {
  VIEWER   // read-only: can see everything, cannot trigger runs or place trades
  EDITOR   // full access: can trigger runs, manage analysts, manage watchlist
}
```

Generate the migration:
```
npx prisma migrate dev --name add-team-access
```

---

## effectiveUserId utility (new file)

**`lib/auth/effective-user.ts`** — new file, no existing content to read first.

```ts
import { prisma } from "@/lib/prisma";

/**
 * For any session userId, return the account owner's userId.
 * If the user is the owner (no membership row), returns userId unchanged.
 * This is the single choke-point for the shared-account model — swap
 * this function's internals to add org-level isolation later.
 */
export async function getEffectiveUserId(userId: string): Promise<string> {
  const membership = await prisma.accountMembership.findFirst({
    where: { memberId: userId },
    select: { ownerId: true },
  });
  return membership?.ownerId ?? userId;
}

/**
 * Returns the role the current session user has relative to the effective
 * account. Used by write routes to gate EDITOR-only actions.
 */
export async function getMemberRole(
  sessionUserId: string,
  ownerId: string,
): Promise<"OWNER" | "EDITOR" | "VIEWER"> {
  if (sessionUserId === ownerId) return "OWNER";
  const m = await prisma.accountMembership.findUnique({
    where: { ownerId_memberId: { ownerId, memberId: sessionUserId } },
    select: { role: true },
  });
  return (m?.role as "EDITOR" | "VIEWER") ?? "VIEWER";
}
```

---

## Route migration pattern

Every API route that currently does:
```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) return new Response("Unauthorized", { status: 401 });
const userId = user.id;   // ← change this
```

Should become:
```ts
import { getEffectiveUserId } from "@/lib/auth/effective-user";

const { data: { user } } = await supabase.auth.getUser();
if (!user) return new Response("Unauthorized", { status: 401 });
const effectiveUserId = await getEffectiveUserId(user.id);
// Use effectiveUserId in all DB queries.
// If the route has write operations and you need to check for VIEWER:
// const role = await getMemberRole(user.id, effectiveUserId);
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

For **write routes** (agent-run, triggers, monitors), add the VIEWER gate — VIEWER members cannot trigger runs or manage analysts. For **read routes** (signals, briefs, activity, theses), no gate needed — all roles can read.

### Inngest functions

The Inngest crons query by `userId` directly from `AgentConfig` — they don't go through a session. **No changes needed to cron functions.** The crons always run as the data owner because they read `AgentConfig.userId` directly from DB rows.

The one exception: `morning-research.ts` and `discovery-run.ts` use `agentConfig.userId` to call `getUserEmail()` for any email sends — this is already the owner's userId, so it's correct as-is.

---

## New API routes (invite flow)

### `POST /api/settings/team/invite`

```ts
// body: { email: string; role: "VIEWER" | "EDITOR" }
// 1. Auth check: user must be OWNER (no membership row for their own userId)
// 2. Create AccountInvite row with token, expiresAt = now() + 7 days
// 3. Send invite email via sendEmail() using team-invite.ts template
// 4. Return { ok: true }
```

Guard: reject if the invited email already has an AccountMembership pointing to this owner.

### `GET /api/settings/team/accept?token=xxx`

```ts
// 1. Find AccountInvite by token; reject if expired or already accepted
// 2. Check if a Supabase user exists for invite.email
//    a. If yes: create AccountMembership { ownerId, memberId: existingUser.id, role }
//    b. If no:  generate a Supabase magic link for invite.email with
//               redirectTo = /settings/team/accept?token=xxx (so they land here
//               after signup with a valid session, then step 2a applies)
// 3. Mark invite.acceptedAt = now()
// 4. Redirect to / (the dashboard, now showing the owner's data)
```

### `DELETE /api/settings/team/members/[memberId]`

```ts
// Owner only. Delete AccountMembership row. Member's account stays intact.
```

### `GET /api/settings/team`

```ts
// Returns: pending invites + active members with role
```

---

## Email template

**`lib/emails/team-invite.ts`** — new file.

Content: short HTML email.  
- Subject: `{ownerName} invited you to Hindsight`  
- Body: "You've been invited to view/collaborate on {ownerName}'s trading analysts. Click below to accept."  
- CTA button → `{APP_URL}/api/settings/team/accept?token={token}`  
- Expiry note: "This link expires in 7 days."

Use the same visual style as `trade-closed.ts` (dark background, white text, branded).

---

## UI components

### `/settings/team` page — new page

Tab or section under Settings. Two panels:

**Active members table** (columns: Email, Role, Joined, Remove button)  
ShadCN Table. Remove button → DELETE request → optimistic remove.  

**Invite form**  
Email input + role select (Viewer / Editor) + "Send Invite" button.  
Below: pending invites list (Email, Role, Expires, Revoke button).  

Wire to the 4 new API routes above.

### Nav account indicator

In the top nav or sidebar: if `sessionUserId !== effectiveUserId`, show a small badge "Viewing Dave's account" with the owner's name. Fetch from `AgentConfig` (any analyst's name field will do — or add a `displayName` to the User model in a follow-up).

For now: `GET /api/settings/team/me` returns `{ isOwner: boolean; ownerName: string | null }`.

---

## Role enforcement summary

| Action | OWNER | EDITOR | VIEWER |
|--------|-------|--------|--------|
| View analysts / runs / positions / theses | ✅ | ✅ | ✅ |
| Trigger a run (agent-run route) | ✅ | ✅ | ❌ |
| Place / close trades | ✅ | ✅ | ❌ |
| Manage analysts (create / edit / delete) | ✅ | ✅ | ❌ |
| Manage watchlist | ✅ | ✅ | ❌ |
| Invite / remove team members | ✅ | ❌ | ❌ |

Implement via the `getMemberRole()` check in write routes. VIEWER hitting a write route gets HTTP 403.

---

## Rollout

1. Delete Dave's second test account from Supabase dashboard (clean slate)
2. Apply the Prisma migration
3. Deploy with the new routes + utility — no behavioral change yet (zero AccountMembership rows)
4. Test the invite flow: send invite to a second email, accept, verify the dashboard shows Dave's analysts
5. Verify crons are unaffected (they run as system; no session; no change)
6. Verify VIEWER gets 403 on write routes

## What NOT to touch

- `lib/auth/` — only add `effective-user.ts`, don't touch Supabase client setup
- Inngest cron functions — they don't use session auth, already run as data owner
- `prisma/schema.prisma` User model — don't add org FKs; keep User as Supabase mirror
- Any podcast or weekly-digest code — out of scope
