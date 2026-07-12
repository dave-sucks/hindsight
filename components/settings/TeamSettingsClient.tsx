"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import type {
  TeamMemberDTO,
  TeamInviteDTO,
} from "@/app/api/settings/team/route";

type Role = "OWNER" | "EDITOR" | "VIEWER";

type EmailPrefKey =
  | "emailTradeProposals"
  | "emailTradeActivity"
  | "emailDailyDigest";

const EMAIL_PREF_COLUMNS: { key: EmailPrefKey; label: string }[] = [
  { key: "emailTradeProposals", label: "Trade proposals" },
  { key: "emailTradeActivity", label: "Trade activity" },
  { key: "emailDailyDigest", label: "Daily digest" },
];

export function TeamSettingsClient({
  accountName,
  myUserId,
  myRole,
  initialMembers,
  initialInvites,
}: {
  accountId: string;
  accountName: string;
  myUserId: string;
  myRole: Role;
  initialMembers: TeamMemberDTO[];
  initialInvites: TeamInviteDTO[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"EDITOR" | "VIEWER">("VIEWER");
  const [isPending, startTransition] = useTransition();

  const canManageTeam = myRole === "OWNER";

  function handleInvite() {
    if (!inviteEmail.trim()) {
      toast.error("Enter an email address.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/settings/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to send invite.");
        return;
      }
      toast.success(`Invited ${inviteEmail.trim()}`);
      setInviteEmail("");
      router.refresh();
    });
  }

  function handleRemoveMember(userId: string, email: string | null) {
    if (!confirm(`Remove ${email ?? userId}? They'll lose access immediately.`)) return;
    const prev = members;
    setMembers((m) => m.filter((x) => x.userId !== userId));
    startTransition(async () => {
      const res = await fetch(`/api/settings/team/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to remove member.");
        setMembers(prev);
        return;
      }
      toast.success("Member removed.");
      router.refresh();
    });
  }

  function handleTogglePref(userId: string, key: EmailPrefKey, value: boolean) {
    const prev = members;
    setMembers((ms) =>
      ms.map((m) => (m.userId === userId ? { ...m, [key]: value } : m)),
    );
    startTransition(async () => {
      const res = await fetch(`/api/settings/team/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to update notifications.");
        setMembers(prev);
      }
    });
  }

  function handleRevokeInvite(id: string, email: string) {
    if (!confirm(`Revoke pending invite for ${email}?`)) return;
    const prev = invites;
    setInvites((i) => i.filter((x) => x.id !== id));
    startTransition(async () => {
      const res = await fetch(`/api/settings/team/invites/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to revoke invite.");
        setInvites(prev);
        return;
      }
      toast.success("Invite revoked.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {/* ── Members ─────────────────────────────────────────────────
          Bare Table — no Card wrapper. ChatGPT/Linear settings style. */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-medium">Members</h2>
          <p className="text-xs text-muted-foreground">
            {members.length} {members.length === 1 ? "member" : "members"} of {accountName}
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isMe = m.userId === myUserId;
              const isOwner = m.role === "OWNER";
              const showRemove = canManageTeam && !isMe && !isOwner;
              return (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">
                    {m.email ?? <span className="text-muted-foreground">unknown</span>}
                    {isMe && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={isOwner ? "default" : "secondary"}>
                      {m.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {showRemove && (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isPending}
                        onClick={() => handleRemoveMember(m.userId, m.email)}
                        aria-label="Remove member"
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      {/* ── Email notifications ─────────────────────────────────────
          Per-member, per-category opt-out. Everyone is subscribed to
          everything by default (defaults live on AccountMembership).
          You can flip your own toggles; the OWNER can flip anyone's. */}
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Email notifications</h2>
          <p className="text-sm text-muted-foreground">
            Which account emails each member receives. Trade proposals are
            approval requests; trade activity covers opened and closed
            positions; the daily digest summarizes each morning run.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              {EMAIL_PREF_COLUMNS.map((c) => (
                <TableHead key={c.key}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isMe = m.userId === myUserId;
              const canEdit = isMe || canManageTeam;
              return (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">
                    {m.email ?? <span className="text-muted-foreground">unknown</span>}
                    {isMe && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </TableCell>
                  {EMAIL_PREF_COLUMNS.map((c) => (
                    <TableCell key={c.key}>
                      <Switch
                        checked={m[c.key]}
                        disabled={!canEdit || isPending}
                        onCheckedChange={(v) => handleTogglePref(m.userId, c.key, v)}
                        aria-label={`${c.label} emails for ${m.email ?? m.userId}`}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      {/* ── Invite a teammate ───────────────────────────────────────
          Single row: InputGroup (email + Role dropdown inside the
          input) + Send button. The Role dropdown uses the Select
          ghost variant so it reads as part of the input. */}
      {canManageTeam && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Invite a teammate</h2>
          <div className="flex items-stretch gap-2">
            <InputGroup className="flex-1">
              <InputGroupInput
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={isPending}
              />
              <InputGroupAddon align="inline-end">
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as "EDITOR" | "VIEWER")}
                >
                  <SelectTrigger size="sm" variant="ghost">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VIEWER">Viewer</SelectItem>
                    <SelectItem value="EDITOR">Editor</SelectItem>
                  </SelectContent>
                </Select>
              </InputGroupAddon>
            </InputGroup>
            <Button onClick={handleInvite} disabled={isPending}>
              Send invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Viewers see every chart, run, and trade — read-only. Editors can also trigger runs and place paper trades. Only OWNERs can invite or remove members.
          </p>
        </section>
      )}

      {/* ── Pending invites ─────────────────────────────────────────
          Same bare Table style as Members; only renders when there
          are unaccepted invites. */}
      {canManageTeam && invites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Pending invites</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{i.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {new Date(i.expiresAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isPending}
                      onClick={() => handleRevokeInvite(i.id, i.email)}
                      aria-label="Revoke invite"
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
