"use client";

import { useState, useTransition } from "react";
import type { OrgTeamMember, OrgPendingInvite, OrgSeatInfo } from "./team-data";
import {
  inviteMember,
  toggleOrgMemberSeatActive,
  changeOrgMemberRole,
  changeOrgMemberEmail,
  revokeOrgInvite,
} from "./team-actions";
import { buttonVariants } from "@/components/button";
import { Avatar } from "@/components/avatar";
import { ASSIGNABLE_ORG_ROLES, ROLE_LABELS } from "@/lib/roles";

type AssignableRole = (typeof ASSIGNABLE_ORG_ROLES)[number];

/**
 * Owners manage the team; admins see the same roster read-only. Nobody
 * can edit their own row, and owner rows are never editable here
 * (owners are assigned and changed from platform admin). The RPCs
 * enforce the same rules, so this is presentation only.
 */
export function TeamScreen({
  orgId,
  members,
  invites,
  seatInfo,
  viewerId,
  canManage,
}: {
  orgId: string;
  members: OrgTeamMember[];
  invites: OrgPendingInvite[];
  seatInfo: OrgSeatInfo;
  viewerId: string;
  canManage: boolean;
}) {
  const atCap = seatInfo.seatCap !== null && seatInfo.seatUsage >= seatInfo.seatCap;

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <SeatUsageBadge seatInfo={seatInfo} />
      ) : (
        <p className="card-inset px-4 py-3 text-sm text-foreground-muted">
          You can view the team. Only the owner can invite people or change roles.
        </p>
      )}

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold">Members</h2>
        {members.length === 0 ? (
          <p className="text-sm text-foreground-muted">No members yet.</p>
        ) : (
          <ul className="flex flex-col">
            {members.map((m) => (
              <MemberRow
                key={m.member_user_id}
                orgId={orgId}
                member={m}
                isSelf={m.member_user_id === viewerId}
                editable={canManage && m.member_user_id !== viewerId && m.member_role !== "owner"}
              />
            ))}
          </ul>
        )}

        {invites.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-foreground-muted">
              Pending invites
            </p>
            <ul className="flex flex-col gap-1.5">
              {invites.map((inv) => (
                <InviteRow key={inv.invite_id} orgId={orgId} invite={inv} canManage={canManage} />
              ))}
            </ul>
          </div>
        )}
      </div>

      {canManage && (
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">Invite a team member</h2>
          <InviteForm orgId={orgId} disabled={atCap || seatInfo.seatCap === null} />
        </div>
      )}
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
      {atCap && ", limit reached"}
    </p>
  );
}

function RoleBadge({ role }: { role: OrgTeamMember["member_role"] }) {
  return (
    <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground-muted">
      {ROLE_LABELS[role]}
    </span>
  );
}

function MemberRow({
  orgId,
  member,
  isSelf,
  editable,
}: {
  orgId: string;
  member: OrgTeamMember;
  isSelf: boolean;
  editable: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [email, setEmail] = useState(member.member_email);

  function onRoleChange(role: AssignableRole) {
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

  function onSaveEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await changeOrgMemberEmail(orgId, member.member_user_id, email);
      if (result.ok) setEditingEmail(false);
      else setError(result.error);
    });
  }

  const displayName = member.member_full_name?.trim();

  return (
    <li className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar
          name={member.member_full_name}
          email={member.member_email}
          avatarPath={member.member_avatar_path}
          size={36}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {displayName || member.member_email}
            {isSelf && <span className="ml-1.5 text-xs font-normal text-foreground-muted">(you)</span>}
          </span>
          {displayName && (
            <span className="truncate text-xs text-foreground-muted">{member.member_email}</span>
          )}
        </div>

        {editable ? (
          <select
            aria-label={`Role for ${member.member_email}`}
            defaultValue={member.member_role}
            disabled={isPending}
            onChange={(e) => onRoleChange(e.target.value as AssignableRole)}
            className="field field-sm"
          >
            {ASSIGNABLE_ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        ) : (
          <RoleBadge role={member.member_role} />
        )}

        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            member.member_seat_active
              ? "bg-accent-soft text-accent"
              : "bg-danger-soft text-danger"
          }`}
        >
          {member.member_seat_active ? "Active" : "Deactivated"}
        </span>

        {editable && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditingEmail((v) => !v);
                setEmail(member.member_email);
                setError(null);
              }}
              disabled={isPending}
              className="btn-ghost btn-sm"
            >
              Change email
            </button>
            <button
              type="button"
              onClick={onToggleActive}
              disabled={isPending}
              className="btn-secondary btn-sm"
            >
              {member.member_seat_active ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        )}
      </div>

      {editable && editingEmail && (
        <form onSubmit={onSaveEmail} className="flex gap-2 pl-12">
          <input
            type="email"
            required
            aria-label="New email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
            className="field field-sm flex-1"
          />
          <button type="submit" disabled={isPending} className="btn-primary btn-sm">
            Save email
          </button>
        </form>
      )}

      {error && <p className="pl-12 text-xs text-danger">{error}</p>}
    </li>
  );
}

function InviteRow({
  orgId,
  invite,
  canManage,
}: {
  orgId: string;
  invite: OrgPendingInvite;
  canManage: boolean;
}) {
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
        {invite.email} ({ROLE_LABELS[invite.role]})
      </span>
      {canManage && (
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
      )}
    </li>
  );
}

function InviteForm({ orgId, disabled }: { orgId: string; disabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("editor");
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
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as AssignableRole)}
          disabled={disabled || isPending}
          className="field"
        >
          {ASSIGNABLE_ORG_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
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
