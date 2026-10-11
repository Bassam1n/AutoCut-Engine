"use client";

import { useState, useTransition } from "react";
import type { OrgMemberRow, PendingInviteRow } from "./membership-data";
import { toggleSeatActive, changeRole, revokeInvite } from "./membership-actions";

const ROLES = ["owner", "admin", "editor"] as const;

export function MembershipTable({
  members,
  invites,
}: {
  members: OrgMemberRow[];
  invites: PendingInviteRow[];
}) {
  const byOrg = groupByOrg(members);
  const invitesByOrg = groupInvitesByOrg(invites);
  const orgIds = Array.from(
    new Set([...Object.keys(byOrg), ...Object.keys(invitesByOrg)])
  );
  const orgNames = Object.fromEntries(
    members.map((m) => [m.org_id, m.org_name] as const)
  );
  for (const inv of invites) orgNames[inv.org_id] ??= inv.org_name;

  if (orgIds.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        No agencies registered yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {orgIds.map((orgId) => (
        <OrgSection
          key={orgId}
          orgName={orgNames[orgId]}
          members={byOrg[orgId] ?? []}
          invites={invitesByOrg[orgId] ?? []}
        />
      ))}
    </div>
  );
}

function OrgSection({
  orgName,
  members,
  invites,
}: {
  orgName: string;
  members: OrgMemberRow[];
  invites: PendingInviteRow[];
}) {
  return (
    <div className="rounded-xl border border-border bg-background-raised p-5">
      <h2 className="mb-3 text-sm font-semibold">{orgName}</h2>

      {members.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-foreground-muted">
              <th className="pb-2 font-medium">Email</th>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium">Access</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.member_user_id} member={m} />
            ))}
          </tbody>
        </table>
      )}

      {invites.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-foreground-muted">
            Pending invites
          </p>
          <ul className="flex flex-col gap-1.5">
            {invites.map((inv) => (
              <InviteRow key={inv.invite_id} invite={inv} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MemberRow({ member }: { member: OrgMemberRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRoleChange(role: (typeof ROLES)[number]) {
    setError(null);
    startTransition(async () => {
      const result = await changeRole(member.org_id, member.member_user_id, role);
      if (!result.ok) setError(result.error);
    });
  }

  function onToggleActive() {
    setError(null);
    startTransition(async () => {
      const result = await toggleSeatActive(
        member.org_id,
        member.member_user_id,
        !member.member_seat_active
      );
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-3">{member.member_email}</td>
      <td className="py-2 pr-3">
        <select
          defaultValue={member.member_role}
          disabled={isPending}
          onChange={(e) => onRoleChange(e.target.value as (typeof ROLES)[number])}
          className="rounded-md border border-border-strong bg-background px-2 py-1 text-xs capitalize outline-none disabled:opacity-60"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            member.member_seat_active
              ? "bg-accent-soft text-accent"
              : "bg-danger-soft text-danger"
          }`}
        >
          {member.member_seat_active ? "Active" : "Deactivated"}
        </span>
      </td>
      <td className="py-2 text-right">
        <button
          type="button"
          onClick={onToggleActive}
          disabled={isPending}
          className="text-xs font-medium text-accent hover:underline disabled:opacity-60"
        >
          {member.member_seat_active ? "Deactivate" : "Reactivate"}
        </button>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </td>
    </tr>
  );
}

function InviteRow({ invite }: { invite: PendingInviteRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);

  function onRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeInvite(invite.invite_id);
      if (result.ok) {
        setRevoked(true);
      } else {
        setError(result.error);
      }
    });
  }

  if (revoked) return null;

  return (
    <li className="flex items-center justify-between text-sm">
      <span className="text-foreground-muted">
        {invite.email}{" "}
        <span className="capitalize">({invite.role})</span>
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRevoke}
          disabled={isPending}
          className="text-xs font-medium text-danger hover:underline disabled:opacity-60"
        >
          Revoke
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </span>
    </li>
  );
}

function groupByOrg(rows: OrgMemberRow[]) {
  const result: Record<string, OrgMemberRow[]> = {};
  for (const row of rows) {
    (result[row.org_id] ??= []).push(row);
  }
  return result;
}

function groupInvitesByOrg(rows: PendingInviteRow[]) {
  const result: Record<string, PendingInviteRow[]> = {};
  for (const row of rows) {
    (result[row.org_id] ??= []).push(row);
  }
  return result;
}
