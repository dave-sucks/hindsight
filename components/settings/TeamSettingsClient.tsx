"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import type {
  TeamMemberDTO,
  TeamInviteDTO,
} from "@/app/api/settings/team/route";

type Role = "OWNER" | "EDITOR" | "VIEWER";

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
    // Optimistic — undo on failure.
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
    <div className="space-y-6">
      {/* Members */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Members</h2>
          <p className="text-xs text-muted-foreground">
            {members.length} {members.length === 1 ? "member" : "members"} of {accountName}
          </p>
        </div>
        <Card>
          <CardContent>
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
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* Invite */}
      {canManageTeam && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Invite a teammate</h2>
          <Card>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-[1fr_140px_auto] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="teammate@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    disabled={isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as "EDITOR" | "VIEWER")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VIEWER">Viewer</SelectItem>
                      <SelectItem value="EDITOR">Editor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button onClick={handleInvite} disabled={isPending}>
                    Send invite
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Viewers see every chart, run, and trade — read-only. Editors can also trigger runs and place paper trades. Only OWNERs can invite or remove members.
              </p>
            </CardContent>
          </Card>

          {invites.length > 0 && (
            <Card>
              <CardContent>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                  Pending invites
                </p>
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
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
