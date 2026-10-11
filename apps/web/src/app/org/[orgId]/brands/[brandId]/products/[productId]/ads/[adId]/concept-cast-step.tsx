"use client";

import { useState, useTransition } from "react";
import {
  generateConcepts,
  selectConcept,
  editSelectedConcept,
  extractCast,
  regenerateCastReference,
  generateCharacterSheet,
  approveCastMember,
} from "../concepts-actions";
import { generateSceneVisuals } from "../scene-visuals-actions";
import type { Ad } from "../ads-data";
import type { Concept, CastMember } from "../concepts-data";
import type { ConceptOption } from "@/lib/claude/schemas/concepts";

export function ConceptCastStep({
  orgId,
  brandId,
  productId,
  ad,
  concept,
  castMembers,
  assetUrls,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  concept: Concept | null;
  castMembers: CastMember[];
  assetUrls: Record<string, string>;
  onContinue: () => void;
}) {
  const [isGenerating, startGenerating] = useTransition();
  const [isExtracting, startExtracting] = useTransition();
  const [isStoryboarding, startStoryboarding] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onGenerateConcepts() {
    setError(null);
    startGenerating(async () => {
      const result = await generateConcepts(orgId, brandId, productId, ad.id);
      if (!result.ok) setError(result.error);
    });
  }

  function onExtractCast() {
    setError(null);
    startExtracting(async () => {
      const result = await extractCast(orgId, brandId, productId, ad.id);
      if (!result.ok) setError(result.error);
    });
  }

  function onGenerateStoryboard() {
    setError(null);
    startStoryboarding(async () => {
      const result = await generateSceneVisuals(orgId, brandId, productId, ad.id);
      if (result.ok) {
        onContinue();
      } else {
        setError(result.error);
      }
    });
  }

  const hasConcepts = Boolean(concept?.options.length);
  const hasSelectedConcept = concept?.selected_idx != null;
  const allCastApproved = castMembers.length > 0 && castMembers.every((c) => c.approved);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Concept &amp; cast</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Claude pitches three visual directions. Pick one, refine it if you
            like, then extract and approve the cast.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerateConcepts}
          disabled={isGenerating}
          className="shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          {isGenerating ? "Generating..." : hasConcepts ? "Regenerate concepts" : "Generate concepts"}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {hasConcepts && concept && (
        <div className="flex flex-col gap-3">
          {concept.options.map((option, i) => (
            <ConceptCard
              key={i}
              orgId={orgId}
              brandId={brandId}
              productId={productId}
              ad={ad}
              option={option}
              index={i}
              isSelected={concept.selected_idx === i}
            />
          ))}
        </div>
      )}

      {hasSelectedConcept && (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Cast</h3>
            <button
              type="button"
              onClick={onExtractCast}
              disabled={isExtracting}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
            >
              {isExtracting ? "Extracting..." : castMembers.length > 0 ? "Re-extract cast" : "Extract cast"}
            </button>
          </div>

          {castMembers.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              No cast extracted yet for this concept.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {castMembers.map((member) => (
                <CastMemberCard
                  key={member.id}
                  orgId={orgId}
                  brandId={brandId}
                  productId={productId}
                  ad={ad}
                  member={member}
                  imageUrl={member.ref_asset_id ? assetUrls[member.ref_asset_id] : undefined}
                  sheetUrl={member.sheet_asset_id ? assetUrls[member.sheet_asset_id] : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {allCastApproved && (
        <button
          type="button"
          onClick={onGenerateStoryboard}
          disabled={isStoryboarding}
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {isStoryboarding ? "Generating storyboard..." : "Generate storyboard →"}
        </button>
      )}
    </div>
  );
}

function ConceptCard({
  orgId,
  brandId,
  productId,
  ad,
  option,
  index,
  isSelected,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  option: ConceptOption;
  index: number;
  isSelected: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [story, setStory] = useState(option.story);
  const [world, setWorld] = useState(option.world);
  const [isPending, startTransition] = useTransition();

  function onSelect() {
    startTransition(() => {
      void selectConcept(orgId, brandId, productId, ad.id, index);
    });
  }

  function onSaveEdit() {
    startTransition(async () => {
      await editSelectedConcept(orgId, brandId, productId, ad.id, index, { ...option, story, world });
      setIsEditing(false);
    });
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border p-4 ${
        isSelected ? "border-accent bg-accent-soft/40" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{option.title}</p>
        {isSelected && <span className="text-xs font-medium text-accent">Selected ✓</span>}
      </div>

      {isEditing ? (
        <>
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            rows={3}
            className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none"
          />
          <textarea
            value={world}
            onChange={(e) => setWorld(e.target.value)}
            rows={2}
            className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={onSaveEdit}
            disabled={isPending}
            className="self-start rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
          >
            Save
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-foreground-muted">{option.story}</p>
          <p className="text-xs text-foreground-muted">
            <span className="font-medium">World:</span> {option.world}
          </p>
        </>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSelect}
          disabled={isPending}
          className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          {isSelected ? "Selected" : "Use this concept"}
        </button>
        {isSelected && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40"
          >
            Refine
          </button>
        )}
      </div>
    </div>
  );
}

function CastMemberCard({
  orgId,
  brandId,
  productId,
  ad,
  member,
  imageUrl,
  sheetUrl,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  member: CastMember;
  imageUrl?: string;
  sheetUrl?: string;
}) {
  const [isPending, startTransition] = useTransition();

  function onRegenerate() {
    const feedback = window.prompt("What should change about this reference image?");
    if (!feedback) return;
    startTransition(() => {
      void regenerateCastReference(orgId, brandId, productId, ad.id, member.id, feedback);
    });
  }

  function onGenerateSheet() {
    startTransition(() => {
      void generateCharacterSheet(orgId, brandId, productId, ad.id, member.id);
    });
  }

  function onApprove() {
    startTransition(() => {
      void approveCastMember(orgId, brandId, productId, ad.id, member.id);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={member.name} className="aspect-[4/5] w-full rounded-lg object-cover" />
      ) : (
        <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg bg-border text-xs text-foreground-muted">
          No image
        </div>
      )}
      <p className="text-sm font-medium">{member.name}</p>
      <p className="text-xs text-foreground-muted">{member.description}</p>
      {member.approved ? (
        <span className="self-start rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
          Approved ✓
        </span>
      ) : (
        <button
          type="button"
          onClick={onApprove}
          disabled={isPending}
          className="self-start rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
        >
          Approve
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={isPending}
          className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
        >
          Regenerate
        </button>
        <button
          type="button"
          onClick={onGenerateSheet}
          disabled={isPending}
          className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
        >
          {sheetUrl ? "Regenerate sheet" : "Character sheet"}
        </button>
      </div>
      {sheetUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sheetUrl} alt={`${member.name} character sheet`} className="w-full rounded-lg object-cover" />
      )}
    </div>
  );
}
