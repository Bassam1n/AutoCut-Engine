"use client";

import { useState, useTransition } from "react";
import type { OrgTeamMember, OrgPendingInvite, OrgSeatInfo } from "./team-data";
import {
  inviteMember,
  toggleOrgMemberSeatActive,
  changeOrgMemberRole,
  revokeOrgInvite,
} from "./team-actions";
import { buttonVariants } from "@/components/button";

const ROLES = ["owner", "admin", "editor"] as const;

export function TeamScreen({
  orgId,
  members,
  invites,
  seatInfo,
}: {
  orgId: string;
  members: OrgTeamMember[];
  invites: OrgPendingInvite[];
  seatInfo: OrgSeatInfo;
}) {
  const atCap = seatInfo.seatCap !== null && seatInfo.seatUsage >= seatInfo.seatCap;

  return (
    <div className="flex flex-col gap-6">
      <SeatUsageBadge seatInfo={seatInfo} />

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold">Members</h2>
        {members.length === 0 ? (
          <p className="text-sm text-foreground-muted">No members yet.</p>
        ) : (
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
                <MemberRow key={m.member_user_id} orgId={orgId} member={m} />
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
                <InviteRow key={inv.invite_id} orgId={orgId} invite={inv} />
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold">Invite a team member</h2>
        <InviteForm orgId={orgId} disabled={atCap || seatInfo.seatCap === null} />
      </div>
    </div>
  );
}

function SeatUsageBadge({ seatInfo }: { seatInfo: OrgSeatInfo }) {
  if (seatInfo.seatCap === null) {
    return (
      <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
        Your seat limit hasn&apos;t been configured yet. Contact the
        platform admin before inviting anyone.
      </p>
    );
  }

  const atCap = seatInfo.seatUsage >= seatInfo.seatCap;

  return (
    <p
      className={`rounded-lg px-3 py-2 text-sm ${
        atCap ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"
      }`}
    >
      {seatInfo.seatUsage} of {seatInfo.seatCap} seats used
      {atCap && " — limit reached"}
    </p>
  );
}

function MemberRow({ orgId, member }: { orgId: string; member: OrgTeamMember }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRoleChange(role: (typeof ROLES)[number]) {
    setError(null);
    startTransition(async () => {
      const result = await changeOrgMemberRole(orgId, member.member_user_id, role);
      if (!result.ok) setError(result.error);
    });
  }

  function onToggleActive() {
    setError(null);
    startTransition(async () => {
      const result = await toggleOrgMemberSeatActive(
        orgId,
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

function InviteRow({ orgId, invite }: { orgId: string; invite: OrgPendingInvite }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);

  function onRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeOrgInvite(orgId, invite.invite_id);
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
        {invite.email} <span className="capitalize">({invite.role})</span>
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

function InviteForm({ orgId, disabled }: { orgId: string; disabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("editor");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await inviteMember(orgId, email, role);
      if (result.ok) {
        setSuccess(true);
        setEmail("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="email"
          required
          placeholder="teammate@agency.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled || isPending}
          className="field flex-1"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          disabled={disabled || isPending}
          className="field capitalize"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={disabled || isPending}
          className={buttonVariants.primary}
        >
          Invite
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && (
        <p className="text-sm text-accent">Invite sent. They&apos;ll get a sign-in link once accepted.</p>
      )}
    </form>
  );
}
