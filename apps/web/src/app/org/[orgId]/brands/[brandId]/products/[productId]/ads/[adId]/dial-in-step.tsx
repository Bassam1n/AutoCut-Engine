"use client";

import { useState, useTransition } from "react";
import { generateDialInQuestions, saveDialInAnswers } from "../dial-in-actions";
import { AsyncButton } from "@/components/async-button";
import type { Ad } from "../ads-data";
import type { DialItInQuestion } from "@/lib/claude/schemas/dial-it-in";
import { buttonVariants } from "@/components/button";

const YOU_DECIDE = "__you_decide__";

/**
 * Spec §5.4 step 2: up to N short questions, one at a time, with
 * tap-to-answer chips and a "you decide" option, viewer topic first
 * then ad topic, ending in a customer card the editor can save.
 * Always skippable. Renamed from Trench's own "Dial it in" label to
 * "Fine-tune the brief" per explicit request — same mechanic, fresh
 * name.
 */
export function DialInStep({
  orgId,
  brandId,
  productId,
  ad,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  onContinue: () => void;
}) {
  const [questions, setQuestions] = useState<DialItInQuestion[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onStart() {
    setError(null);
    startLoading(async () => {
      const result = await generateDialInQuestions(orgId, brandId, productId, ad.id);
      if (result.ok) {
        setQuestions(result.questions);
        setCurrent(0);
      } else {
        setError(result.error);
      }
    });
  }

  function onAnswer(questionId: string, value: string) {
    if (value !== YOU_DECIDE) {
      setAnswers((prev) => ({ ...prev, [questionId]: value }));
    }
    setCurrent((i) => i + 1);
  }

  const isDone = questions !== null && current >= questions.length;

  function onFinish(customerName: string) {
    if (!questions) return;
    setError(null);

    const viewerAnswers: Record<string, string> = {};
    const adAnswers: Record<string, string> = {};
    for (const q of questions) {
      const answer = answers[q.id];
      if (!answer) continue;
      if (q.topic === "viewer") viewerAnswers[q.id] = answer;
      else adAnswers[q.id] = answer;
    }

    startSaving(async () => {
      const result = await saveDialInAnswers(
        orgId,
        brandId,
        productId,
        ad.id,
        customerName,
        viewerAnswers,
        adAnswers
      );
      if (result.ok) {
        onContinue();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Fine-tune the brief</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          A few quick optional questions to sharpen who this ad is for and
          what it should look like — skip any time.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {questions === null ? (
        <div className="flex gap-2">
          <AsyncButton
            onClick={onStart}
            isPending={isLoading}
            pendingLabel="Preparing questions..."
            className={`self-start ${buttonVariants.primary}`}
          >
            Start
          </AsyncButton>
          <button
            type="button"
            onClick={onContinue}
            className="self-start rounded-lg border border-border-strong px-4 py-2 text-sm font-medium transition-colors hover:bg-border/40"
          >
            Skip for now →
          </button>
        </div>
      ) : questions.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground-muted">
            Nothing left to ask — your brief and saved customer already cover this.
          </p>
          <button
            type="button"
            onClick={onContinue}
            className={`self-start ${buttonVariants.primary}`}
          >
            Continue →
          </button>
        </div>
      ) : isDone ? (
        <FinishCard isSaving={isSaving} onFinish={onFinish} onSkipSave={onContinue} />
      ) : (
        <QuestionCard
          question={questions[current]}
          index={current}
          total={questions.length}
          onAnswer={onAnswer}
        />
      )}
    </div>
  );
}

function QuestionCard({
  question,
  index,
  total,
  onAnswer,
}: {
  question: DialItInQuestion;
  index: number;
  total: number;
  onAnswer: (questionId: string, value: string) => void;
}) {
  const [customValue, setCustomValue] = useState("");

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
        Question {index + 1} of {total} — {question.topic === "viewer" ? "about the viewer" : "about the ad"}
      </p>
      <p className="text-sm font-medium">{question.question}</p>

      <div className="flex flex-wrap gap-2">
        {question.chip_options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onAnswer(question.id, option)}
            className="rounded-full border border-border-strong px-3 py-1.5 text-sm transition-colors hover:bg-border/40"
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onAnswer(question.id, YOU_DECIDE)}
          className="rounded-full border border-dashed border-border-strong px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-border/40"
        >
          You decide
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          placeholder="Or type your own answer"
          className="flex-1 rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => customValue.trim() && onAnswer(question.id, customValue.trim())}
          disabled={!customValue.trim()}
          className="rounded-lg border border-border-strong px-3 py-2 text-sm font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          Use this
        </button>
      </div>
    </div>
  );
}

function FinishCard({
  isSaving,
  onFinish,
  onSkipSave,
}: {
  isSaving: boolean;
  onFinish: (customerName: string) => void;
  onSkipSave: () => void;
}) {
  const [customerName, setCustomerName] = useState("");

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">All set. Save this as a customer profile?</p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">Customer name</label>
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="e.g. Sarah"
          disabled={isSaving}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex gap-2">
        <AsyncButton
          onClick={() => onFinish(customerName)}
          isPending={isSaving}
          pendingLabel="Saving..."
          className={buttonVariants.primary}
        >
          Save &amp; continue
        </AsyncButton>
        <button
          type="button"
          onClick={onSkipSave}
          disabled={isSaving}
          className="rounded-lg border border-border-strong px-4 py-2 text-sm font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          Skip saving
        </button>
      </div>
    </div>
  );
}
