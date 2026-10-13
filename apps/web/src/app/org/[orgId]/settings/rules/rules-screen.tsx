"use client";

import { useState, useTransition } from "react";
import type { RuleRow, ScopeNameLookup } from "./rules-data";
import { updateRule, setRuleActive, deleteRule } from "./rules-actions";

function scopeLabel(rule: RuleRow, scopeNames: ScopeNameLookup): string {
  if (rule.scope === "org") return "Org-wide";
  const name =
    rule.scope === "brand"
      ? scopeNames.brands[rule.scope_id ?? ""]
      : rule.scope === "style"
        ? scopeNames.styles[rule.scope_id ?? ""]
        : scopeNames.products[rule.scope_id ?? ""];
  const scopeKindLabel = rule.scope === "brand" ? "Brand" : rule.scope === "style" ? "Style" : "Product";
  return `${scopeKindLabel}: ${name ?? rule.scope_id ?? "unknown"}`;
}

export function RulesScreen({
  orgId,
  rules,
  scopeNames,
  canAdminister,
}: {
  orgId: string;
  rules: RuleRow[];
  scopeNames: ScopeNameLookup;
  canAdminister: boolean;
}) {
  const activeRules = rules.filter((r) => r.active);
  const pausedRules = rules.filter((r) => !r.active);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Active ({activeRules.length})
        </p>
        {activeRules.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            No active rules yet. Rules appear here once a remembered correction recurs at least
            twice and the daily distillation job turns it into a DO/AVOID rule.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {activeRules.map((rule) => (
              <RuleCard key={rule.id} orgId={orgId} rule={rule} scopeNames={scopeNames} canAdminister={canAdminister} />
            ))}
          </div>
        )}
      </section>

      {pausedRules.length > 0 && (
        <section>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Paused ({pausedRules.length})
          </p>
          <div className="flex flex-col gap-2">
            {pausedRules.map((rule) => (
              <RuleCard key={rule.id} orgId={orgId} rule={rule} scopeNames={scopeNames} canAdminister={canAdminister} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RuleCard({
  orgId,
  rule,
  scopeNames,
  canAdminister,
}: {
  orgId: string;
  rule: RuleRow;
  scopeNames: ScopeNameLookup;
  canAdminister: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);
  const [kind, setKind] = useState<"do" | "avoid">(rule.kind);

  function onSaveEdit() {
    setError(null);
    startTransition(async () => {
      const result = await updateRule(orgId, rule.id, { text, kind });
      if (result.ok) setEditing(false);
      else setError(result.error);
    });
  }

  function onTogglePause() {
    setError(null);
    startTransition(async () => {
      const result = await setRuleActive(orgId, rule.id, !rule.active);
      if (!result.ok) setError(result.error);
    });
  }

  function onDelete() {
    setError(null);
    if (!window.confirm("Delete this rule permanently? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteRule(orgId, rule.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div
      className={`rounded-xl border border-border bg-background-raised p-4 ${
        rule.active ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                rule.kind === "do" ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"
              }`}
            >
              {rule.kind.toUpperCase()}
            </span>
            <span className="text-xs text-foreground-muted">{scopeLabel(rule, scopeNames)}</span>
          </div>

          {editing ? (
            <div className="mt-1 flex flex-col gap-2">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "do" | "avoid")}
                className="field w-fit"
              >
                <option value="do">DO</option>
                <option value="avoid">AVOID</option>
              </select>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="field w-full p-2"
              />
            </div>
          ) : (
            <p className="mt-0.5 text-sm">{rule.text}</p>
          )}

          <p className="mt-1 text-[11px] text-foreground-muted">
            Confidence {rule.confidence.toFixed(2)} · reinforced {rule.reinforced_count}×
          </p>
        </div>

        {canAdminister && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {editing ? (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={onSaveEdit}
                  disabled={isPending}
                  className="btn-primary btn-sm"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setText(rule.text);
                    setKind(rule.kind);
                  }}
                  className="btn-secondary btn-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="btn-secondary btn-sm"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onTogglePause}
              disabled={isPending}
              className="btn-secondary btn-sm"
            >
              {rule.active ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isPending}
              className="rounded-lg border border-danger/30 px-2.5 py-1 text-xs font-medium text-danger disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
