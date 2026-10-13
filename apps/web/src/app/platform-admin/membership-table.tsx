"use client";

import { useState, useTransition } from "react";
import type { OrgMemberRow, PendingInviteRow } from "./membership-data";
import { toggleSeatActive, changeRole, revokeInvite, setOrgSeatCap } from "./membership-actions";

const ROLES = ["owner", "admin", "editor"] as const;

type OrgGroup = {
  orgId: string;
  orgName: string;
  seatCap: number | null;
  members: OrgMemberRow[];
  invites: PendingInviteRow[];
};

export function MembershipTable({
  members,
  invites,
}: {
  members: OrgMemberRow[];
  invites: PendingInviteRow[];
}) {
  const groups = groupByOrg(members, invites);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        No agencies registered yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <OrgSection key={group.orgId} group={group} />
      ))}
    </div>
  );
}

function OrgSection({ group }: { group: OrgGroup }) {
  const activeMembers = group.members.filter((m) => m.member_user_id !== null);
  const seatUsage = activeMembers.filter((m) => m.member_seat_active).length + group.invites.length;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{group.orgName}</h2>
        <SeatCapEditor orgId={group.orgId} seatCap={group.seatCap} seatUsage={seatUsage} />
      </div>

      {activeMembers.length > 0 ? (
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
            {activeMembers.map((m) => (
              <MemberRow key={m.member_user_id} member={m} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-foreground-muted">
          No one has accepted the owner invite yet.
        </p>
      )}

      {group.invites.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-foreground-muted">
            Pending invites
          </p>
          <ul className="flex flex-col gap-1.5">
            {group.invites.map((inv) => (
              <InviteRow key={inv.invite_id} invite={inv} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SeatCapEditor({
  orgId,
  seatCap,
  seatUsage,
}: {
  orgId: string;
  seatCap: number | null;
  seatUsage: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(seatCap === null ? "" : String(seatCap));
  const [error, setError] = useState<string | null>(null);

  function onSave() {
    setError(null);
    const parsed = value.trim() === "" ? null : Number(value);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)) {
      setError("Must be a positive whole number");
      return;
    }
    startTransition(async () => {
      const result = await setOrgSeatCap(orgId, parsed);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-foreground-muted">
        {seatUsage} used ·
      </span>
      <input
        type="number"
        min={1}
        placeholder="No cap set"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isPending}
        className="field field-sm w-24"
      />
      <button
        type="button"
        onClick={onSave}
        disabled={isPending}
        className="text-xs font-medium text-accent hover:underline disabled:opacity-60"
      >
        Save seat cap
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

function MemberRow({ member }: { member: OrgMemberRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!member.member_user_id || !member.member_role) return null;
  const userId = member.member_user_id;

  function onRoleChange(role: (typeof ROLES)[number]) {
    setError(null);
    startTransition(async () => {
      const result = await changeRole(member.org_id, userId, role);
      if (!result.ok) setError(result.error);
    });
  }

  function onToggleActive() {
    setError(null);
    startTransition(async () => {
      const result = await toggleSeatActive(member.org_id, userId, !member.member_seat_active);
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
          className="field field-sm capitalize"
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

function groupByOrg(members: OrgMemberRow[], invites: PendingInviteRow[]): OrgGroup[] {
  const byOrg = new Map<string, OrgGroup>();

  for (const row of members) {
    let group = byOrg.get(row.org_id);
    if (!group) {
      group = {
        orgId: row.org_id,
        orgName: row.org_name,
        seatCap: row.org_seat_cap,
        members: [],
        invites: [],
      };
      byOrg.set(row.org_id, group);
    }
    group.members.push(row);
  }

  for (const inv of invites) {
    let group = byOrg.get(inv.org_id);
    if (!group) {
      group = {
        orgId: inv.org_id,
        orgName: inv.org_name,
        seatCap: null,
        members: [],
        invites: [],
      };
      byOrg.set(inv.org_id, group);
    }
    group.invites.push(inv);
  }

  return Array.from(byOrg.values()).sort((a, b) => a.orgName.localeCompare(b.orgName));
}
