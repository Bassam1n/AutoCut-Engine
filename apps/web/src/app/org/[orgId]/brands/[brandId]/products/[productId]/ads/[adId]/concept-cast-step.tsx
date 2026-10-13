"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import { AsyncButton } from "@/components/async-button";
import { ModelPicker } from "@/components/model-picker";
import {
  generateConcepts,
  selectConcept,
  editSelectedConcept,
  extractCast,
  regenerateCastReference,
  generateCharacterSheet,
  approveCastMember,
  approveAllCastMembers,
  reserveCastReferenceUploadPath,
  recordUploadedCastReference,
  type ModelChoice,
} from "../concepts-actions";
import { generateSceneVisuals } from "../scene-visuals-actions";
import type { Ad } from "../ads-data";
import type { Concept, CastMember } from "../concepts-data";
import type { ConceptOption } from "@/lib/claude/schemas/concepts";
import type { ModelOption } from "@/lib/providers/models-data";

export function ConceptCastStep({
  orgId,
  brandId,
  productId,
  ad,
  concept,
  castMembers,
  assetUrls,
  imageModelOptions,
  providersWithKeys,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  concept: Concept | null;
  castMembers: CastMember[];
  assetUrls: Record<string, string>;
  imageModelOptions: ModelOption[];
  providersWithKeys: Set<string>;
  onContinue: () => void;
}) {
  const [isGenerating, startGenerating] = useTransition();
  const [isExtracting, startExtracting] = useTransition();
  const [isStoryboarding, startStoryboarding] = useTransition();
  const [isApprovingAll, startApprovingAll] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [imageModel, setImageModel] = useState<ModelOption | null>(imageModelOptions[0] ?? null);

  const returnToPath = `/org/${orgId}/brands/${brandId}/products/${productId}/ads/${ad.id}`;

  function onGenerateConcepts() {
    setError(null);
    startGenerating(async () => {
      const result = await generateConcepts(orgId, brandId, productId, ad.id);
      if (!result.ok) setError(result.error);
    });
  }

  function onExtractCast() {
    setError(null);
    if (!imageModel) {
      setError("Pick an image model first.");
      return;
    }
    const model: ModelChoice = { provider: imageModel.provider as "fal" | "kie", endpoint: imageModel.endpoint };
    startExtracting(async () => {
      const result = await extractCast(orgId, brandId, productId, ad.id, model);
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
  const hasUnapprovedCast = castMembers.some((c) => !c.approved);

  function onApproveAll() {
    setError(null);
    startApprovingAll(async () => {
      const result = await approveAllCastMembers(orgId, brandId, productId, ad.id);
      if (!result.ok) setError(result.error);
    });
  }

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
        <AsyncButton
          onClick={onGenerateConcepts}
          isPending={isGenerating}
          pendingLabel="Generating concepts..."
          className="shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40"
        >
          {hasConcepts ? "Regenerate concepts" : "Generate concepts"}
        </AsyncButton>
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
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold">Cast</h3>
            <div className="flex items-center gap-2">
              {hasUnapprovedCast && (
                <AsyncButton
                  onClick={onApproveAll}
                  isPending={isApprovingAll}
                  pendingLabel="Approving..."
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
                >
                  Approve all
                </AsyncButton>
              )}
              <AsyncButton
                onClick={onExtractCast}
                isPending={isExtracting}
                pendingLabel="Extracting cast..."
                className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40"
              >
                {castMembers.length > 0 ? "Re-extract cast" : "Extract cast"}
              </AsyncButton>
            </div>
          </div>

          {imageModelOptions.length > 0 && (
            <ModelPicker
              orgId={orgId}
              options={imageModelOptions}
              providersWithKeys={providersWithKeys}
              value={imageModel ? { provider: imageModel.provider, endpoint: imageModel.endpoint } : null}
              onChange={setImageModel}
              returnToPath={returnToPath}
            />
          )}

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
                  imageModel={imageModel}
                  imageModelOptions={imageModelOptions}
                  providersWithKeys={providersWithKeys}
                  returnToPath={returnToPath}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {allCastApproved && (
        <AsyncButton
          onClick={onGenerateStoryboard}
          isPending={isStoryboarding}
          pendingLabel="Generating storyboard..."
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Generate storyboard →
        </AsyncButton>
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
  const [error, setError] = useState<string | null>(null);

  function onSelect() {
    setError(null);
    startTransition(async () => {
      const result = await selectConcept(orgId, brandId, productId, ad.id, index);
      if (!result.ok) setError(result.error);
    });
  }

  function onSaveEdit() {
    setError(null);
    startTransition(async () => {
      const result = await editSelectedConcept(orgId, brandId, productId, ad.id, index, { ...option, story, world });
      if (result.ok) {
        setIsEditing(false);
      } else {
        setError(result.error);
      }
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
      {error && <p className="text-xs text-danger">{error}</p>}
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
  imageModel,
  imageModelOptions,
  providersWithKeys,
  returnToPath,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  member: CastMember;
  imageUrl?: string;
  sheetUrl?: string;
  imageModel: ModelOption | null;
  imageModelOptions: ModelOption[];
  providersWithKeys: Set<string>;
  returnToPath: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetStatus, setSheetStatus] = useState<"idle" | "generating" | "failed">("idle");

  function onGenerateSheet() {
    setError(null);
    if (!imageModel) {
      setError("Pick an image model first.");
      return;
    }
    setSheetStatus("generating");
    const model: ModelChoice = { provider: imageModel.provider as "fal" | "kie", endpoint: imageModel.endpoint };
    startTransition(async () => {
      const result = await generateCharacterSheet(orgId, brandId, productId, ad.id, member.id, model);
      if (result.ok) {
        setSheetStatus("idle");
      } else {
        setSheetStatus("failed");
        setError(result.error);
      }
    });
  }

  function onApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveCastMember(orgId, brandId, productId, ad.id, member.id);
      if (!result.ok) setError(result.error);
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
      {error && <p className="text-xs text-danger">{error}</p>}
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
          onClick={() => setIsRegenerateOpen(true)}
          disabled={isPending}
          className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
        >
          Regenerate
        </button>
        <AsyncButton
          onClick={onGenerateSheet}
          isPending={sheetStatus === "generating"}
          disabled={isPending}
          pendingLabel="Generating sheet..."
          className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-border/40"
        >
          {sheetUrl ? "Regenerate sheet" : "Character sheet"}
        </AsyncButton>
      </div>
      {sheetUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sheetUrl} alt={`${member.name} character sheet`} className="w-full rounded-lg object-cover" />
      )}

      {isRegenerateOpen && (
        <RegenerateModal
          orgId={orgId}
          brandId={brandId}
          productId={productId}
          ad={ad}
          member={member}
          imageUrl={imageUrl}
          imageModel={imageModel}
          imageModelOptions={imageModelOptions}
          providersWithKeys={providersWithKeys}
          returnToPath={returnToPath}
          onClose={() => setIsRegenerateOpen(false)}
        />
      )}
    </div>
  );
}

function RegenerateModal({
  orgId,
  brandId,
  productId,
  ad,
  member,
  imageUrl,
  imageModel,
  imageModelOptions,
  providersWithKeys,
  returnToPath,
  onClose,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  member: CastMember;
  imageUrl?: string;
  imageModel: ModelOption | null;
  imageModelOptions: ModelOption[];
  providersWithKeys: Set<string>;
  returnToPath: string;
  onClose: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelOption | null>(imageModel);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onRegenerateWithFeedback() {
    setError(null);
    if (!selectedModel) {
      setError("Pick an image model first.");
      return;
    }
    const model: ModelChoice = { provider: selectedModel.provider as "fal" | "kie", endpoint: selectedModel.endpoint };
    startTransition(async () => {
      const result = await regenerateCastReference(orgId, brandId, productId, ad.id, member.id, feedback || "make it better", model);
      if (result.ok) {
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      const reserved = await reserveCastReferenceUploadPath(orgId, brandId, file.name);
      if (!reserved.ok) {
        setError(reserved.error);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("renders")
        .upload(reserved.path, file, { upsert: false });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const result = await recordUploadedCastReference(orgId, brandId, productId, ad.id, member.id, reserved.path);
      if (result.ok) {
        onClose();
      } else {
        setError(result.error);
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Modal title={`Update ${member.name}'s reference image`} onClose={onClose}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={member.name} className="aspect-[4/5] w-full rounded-lg object-cover" />
      ) : (
        <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg bg-border text-xs text-foreground-muted">
          No current image
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {imageModelOptions.length > 0 && (
          <ModelPicker
            orgId={orgId}
            options={imageModelOptions}
            providersWithKeys={providersWithKeys}
            value={selectedModel ? { provider: selectedModel.provider, endpoint: selectedModel.endpoint } : null}
            onChange={setSelectedModel}
            returnToPath={returnToPath}
          />
        )}
        <label className="text-xs font-medium">Small change — describe what to adjust</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder="e.g. make the expression friendlier"
          disabled={isPending || isUploading}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
        <AsyncButton
          onClick={onRegenerateWithFeedback}
          isPending={isPending}
          disabled={isUploading}
          pendingLabel="Regenerating..."
          className="self-start rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Regenerate
        </AsyncButton>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <label className="text-xs font-medium">Big change — upload your own image instead</label>
        <label
          className={`self-start rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium ${
            isUploading || isPending ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-border/40"
          }`}
        >
          {isUploading ? "Uploading..." : "Upload image"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            disabled={isUploading || isPending}
            className="hidden"
          />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </Modal>
  );
}
