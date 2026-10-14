"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { ROLE_LABELS, type OrgRole } from "@/lib/roles";
import { PLANS, PLAN_LABELS, type AgencySummary, type Plan } from "../../model";
import type { AgencyInvite, AgencyMember } from "../../data";
import {
  inviteToAgency,
  regenerateInviteLink,
  resumeAgency,
  setAgencySuspended,
  setSpendLimits,
  updateAgency,
  type ActionResult,
} from "../../agency-actions";
import {
  changeMemberEmail,
  changeRole,
  revokeInvite,
  setMemberAdAccess,
  setOrgSeatCap,
  toggleSeatActive,
} from "../../membership-actions";

const ROLES: OrgRole[] = ["owner", "admin", "editor"];

/** Runs a server action, refreshes the page on success, and keeps the last error. */
function useAction() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return { isPending, error, run, setError };
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-foreground-muted">
        Send this sign-in link to them. It works once and expires, so generate a new one if it&apos;s been a while.
      </p>
      <div className="flex gap-2">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="field field-sm min-w-0 flex-1 font-mono" />
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header quick actions                                                */
/* ------------------------------------------------------------------ */

export function AgencyQuickActions({ orgId, suspended, paused }: { orgId: string; suspended: boolean; paused: boolean }) {
  const { isPending, error, run } = useAction();
  const [suspendOpen, setSuspendOpen] = useState(false);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {paused && !suspended && (
          <button type="button" className="btn-secondary btn-sm" disabled={isPending} onClick={() => run(() => resumeAgency(orgId))}>
            Resume spending
          </button>
        )}
        {suspended ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={isPending}
            onClick={() => run(() => setAgencySuspended(orgId, false, ""))}
          >
            Reactivate agency
          </button>
        ) : (
          <button type="button" className="btn-danger btn-sm" disabled={isPending} onClick={() => setSuspendOpen(true)}>
            Suspend
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {suspendOpen && <SuspendModal orgId={orgId} onClose={() => setSuspendOpen(false)} />}
    </div>
  );
}

function SuspendModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { isPending, error, run } = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title="Suspend this agency?" onClose={onClose}>
      <p className="text-sm text-foreground-muted">
        Every member loses access right away and queued generations stop. Nothing is deleted; reactivating restores everything.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Reason (only platform admins see this)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Invoice overdue" className="field" />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-danger btn-sm"
          disabled={isPending}
          onClick={() => run(() => setAgencySuspended(orgId, true, reason), onClose)}
        >
          {isPending ? "Suspending..." : "Suspend agency"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

export function MembersPanel({
  agency,
  members,
  invites,
}: {
  agency: AgencySummary;
  members: AgencyMember[];
  invites: AgencyInvite[];
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const used = agency.members_active + agency.pending_invites;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground-muted">
          {agency.members_active} active seat{agency.members_active === 1 ? "" : "s"}
          {agency.pending_invites > 0 ? `, ${agency.pending_invites} pending` : ""} of{" "}
          {agency.seat_cap ?? "no cap"}
          {agency.seat_cap !== null && used >= agency.seat_cap ? " (full; your invites ignore the cap)" : ""}
        </p>
        <button type="button" className="btn-primary btn-sm" onClick={() => setInviteOpen(true)}>
          Invite member
        </button>
      </div>

      <div className="card relative overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-foreground-muted">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Ad creation</th>
              <th className="px-4 py-3 font-medium">Seat</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-foreground-muted">
                  Nobody has joined yet.
                </td>
              </tr>
            ) : (
              members.map((m) => <MemberRow key={m.user_id} orgId={agency.org_id} member={m} />)
            )}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Pending invites</h2>
          <div className="card divide-y divide-border">
            {invites.map((i) => (
              <InviteRow key={i.invite_id} invite={i} />
            ))}
          </div>
        </section>
      )}

      {inviteOpen && <InviteModal orgId={agency.org_id} onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

function MemberRow({ orgId, member }: { orgId: string; member: AgencyMember }) {
  const { isPending, error, run } = useAction();
  const [editingEmail, setEditingEmail] = useState(false);
  const [email, setEmail] = useState(member.email);
  const adValue = member.can_create_ads === null ? "default" : member.can_create_ads ? "on" : "off";
  const roleDefault = member.role === "editor" ? "On" : "Off";

  return (
    <tr className={`border-b border-border align-top last:border-b-0 ${member.seat_active ? "" : "opacity-60"}`}>
      <td className="px-4 py-3">
        {editingEmail ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => changeMemberEmail(orgId, member.user_id, email), () => setEditingEmail(false));
            }}
          >
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field field-sm min-w-0 flex-1" autoFocus />
            <button type="submit" className="btn-primary btn-xs" disabled={isPending}>
              Save
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => {
                setEmail(member.email);
                setEditingEmail(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span className="block font-medium">{member.email}</span>
            <span className="block text-xs text-foreground-muted">Joined {new Date(member.joined_at).toLocaleDateString()}</span>
          </>
        )}
        {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
      </td>
      <td className="px-4 py-3">
        <select
          aria-label={`Role for ${member.email}`}
          value={member.role}
          disabled={isPending}
          onChange={(e) => run(() => changeRole(orgId, member.user_id, e.target.value as OrgRole))}
          className="field field-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <select
          aria-label={`Ad creation for ${member.email}`}
          value={adValue}
          disabled={isPending}
          onChange={(e) =>
            run(() => setMemberAdAccess(orgId, member.user_id, e.target.value === "default" ? null : e.target.value === "on"))
          }
          className="field field-sm"
        >
          <option value="default">Role default ({roleDefault})</option>
          <option value="on">Allowed</option>
          <option value="off">Blocked</option>
        </select>
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={member.seat_active}
          aria-label={`Seat for ${member.email}`}
          disabled={isPending}
          onClick={() => run(() => toggleSeatActive(orgId, member.user_id, !member.seat_active))}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            member.seat_active ? "bg-accent" : "bg-border-strong"
          }`}
        >
          <span
            className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
              member.seat_active ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        {!editingEmail && (
          <button type="button" className="btn-ghost btn-xs" onClick={() => setEditingEmail(true)}>
            Change email
          </button>
        )}
      </td>
    </tr>
  );
}

function InviteRow({ invite }: { invite: AgencyInvite }) {
  const { isPending, error, run } = useAction();
  const [link, setLink] = useState<string | null>(null);
  const [linkPending, startLink] = useTransition();
  const [linkError, setLinkError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium">{invite.email}</span>
          <span className="block text-xs text-foreground-muted">
            {ROLE_LABELS[invite.role]} · invited {new Date(invite.invited_at).toLocaleDateString()}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary btn-xs"
            disabled={linkPending}
            onClick={() => {
              setLinkError(null);
              startLink(async () => {
                const result = await regenerateInviteLink(invite.email);
                if (result.ok) setLink(result.link);
                else setLinkError(result.error);
              });
            }}
          >
            {linkPending ? "Generating..." : "New sign-in link"}
          </button>
          <button type="button" className="btn-ghost btn-xs" disabled={isPending} onClick={() => run(() => revokeInvite(invite.invite_id))}>
            Revoke
          </button>
        </div>
      </div>
      {link && <CopyLink link={link} />}
      {(error || linkError) && <p className="text-xs text-danger">{error ?? linkError}</p>}
    </div>
  );
}

function InviteModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Modal title={link ? "Invite created" : "Invite a member"} onClose={onClose}>
      {link ? (
        <>
          <CopyLink link={link} />
          <div className="flex justify-end">
            <button type="button" className="btn-primary btn-sm" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await inviteToAgency(orgId, email, role);
              if (result.ok) {
                setLink(result.link);
                router.refresh();
              } else setError(result.error);
            });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field" autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className="field">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary btn-sm" disabled={isPending}>
              {isPending ? "Inviting..." : "Create invite"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function AgencySettingsPanel({ agency }: { agency: AgencySummary }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <DetailsCard agency={agency} />
      <div className="flex flex-col gap-6">
        <LimitsCard agency={agency} />
        <DangerCard agency={agency} />
      </div>
    </div>
  );
}

function SaveRow({ isPending, error, saved }: { isPending: boolean; error: string | null; saved: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <button type="submit" className="btn-primary btn-sm" disabled={isPending}>
        {isPending ? "Saving..." : "Save"}
      </button>
      {saved && !error && <span className="text-xs text-foreground-muted">Saved</span>}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

function DetailsCard({ agency }: { agency: AgencySummary }) {
  const { isPending, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(agency.org_name);
  const [plan, setPlan] = useState<Plan>(agency.plan);
  const [notes, setNotes] = useState(agency.internal_notes ?? "");

  return (
    <form
      className="card flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => updateAgency(agency.org_id, name, plan, notes), () => setSaved(true));
      }}
    >
      <h2 className="text-sm font-semibold">Agency details</h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} className="field" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Plan</span>
        <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} className="field">
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]}
            </option>
          ))}
        </select>
        <span className="text-xs text-foreground-muted">A label for your records. It doesn&apos;t change limits on its own.</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Internal notes</span>
        <textarea
          rows={6}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Contract terms, billing contact, anything worth remembering. Only platform admins see this."
          className="field resize-y"
        />
      </label>
      <SaveRow isPending={isPending} error={error} saved={saved} />
    </form>
  );
}

function LimitsCard({ agency }: { agency: AgencySummary }) {
  const { isPending, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const [seatCap, setSeatCap] = useState(agency.seat_cap === null ? "" : String(agency.seat_cap));
  const [warn, setWarn] = useState(String(agency.warn_usd ?? 300));
  const [stop, setStop] = useState(String(agency.stop_usd ?? 600));

  return (
    <form
      className="card flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const cap = seatCap.trim() === "" ? null : Number.parseInt(seatCap, 10);
        run(async () => {
          if (cap !== agency.seat_cap) {
            const capResult = await setOrgSeatCap(agency.org_id, cap);
            if (!capResult.ok) return capResult;
          }
          return setSpendLimits(agency.org_id, Number.parseFloat(warn), Number.parseFloat(stop));
        }, () => setSaved(true));
      }}
    >
      <h2 className="text-sm font-semibold">Limits</h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Seat cap</span>
        <input type="number" min={1} value={seatCap} onChange={(e) => setSeatCap(e.target.value)} placeholder="No cap" className="field" />
        <span className="text-xs text-foreground-muted">Active members plus pending invites. Without a cap the owner can&apos;t invite anyone.</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Daily warning (USD)</span>
          <input type="number" min={0} step="0.01" value={warn} onChange={(e) => setWarn(e.target.value)} required className="field" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Daily stop (USD)</span>
          <input type="number" min={0} step="0.01" value={stop} onChange={(e) => setStop(e.target.value)} required className="field" />
        </label>
      </div>
      <span className="-mt-2 text-xs text-foreground-muted">
        Measured over the last 24 hours. Past the stop, generations pause until you resume them (default $300 / $600).
      </span>
      <SaveRow isPending={isPending} error={error} saved={saved} />
    </form>
  );
}

function DangerCard({ agency }: { agency: AgencySummary }) {
  const { isPending, error, run } = useAction();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const suspended = Boolean(agency.suspended_at);

  return (
    <section className="card flex flex-col gap-3 border-danger/40 p-5">
      <h2 className="text-sm font-semibold">{suspended ? "Suspended" : "Suspend agency"}</h2>
      <p className="text-sm text-foreground-muted">
        {suspended
          ? `Members can't access this agency${agency.suspended_reason ? ` (${agency.suspended_reason})` : ""}. Reactivating restores everything.`
          : "Blocks every member and stops queued generations. Nothing is deleted."}
      </p>
      <div className="flex items-center gap-3">
        {suspended ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={isPending}
            onClick={() => run(() => setAgencySuspended(agency.org_id, false, ""))}
          >
            Reactivate agency
          </button>
        ) : (
          <button type="button" className="btn-danger btn-sm" onClick={() => setSuspendOpen(true)}>
            Suspend agency
          </button>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
      {suspendOpen && <SuspendModal orgId={agency.org_id} onClose={() => setSuspendOpen(false)} />}
    </section>
  );
}
