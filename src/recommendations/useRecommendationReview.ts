/**
 * useRecommendationReview.ts -- the only place in this stage that
 * touches React state, same division of responsibility as
 * useAlarmSystem.ts: `engine.ts` stays a pure function of
 * (board, now), and this hook just remembers what the operator
 * decided about each recommendation it was shown.
 *
 * This is explicitly NOT an ISA-18.2 audit journal -- stage 1's
 * README already scopes that out for the whole project. It's an
 * in-memory list that exists so an operator (or a reviewer of this
 * project) can see what was reviewed and why, for as long as the
 * page stays open; it's lost on refresh, same as the rest of this
 * app's state.
 */

import { useCallback, useState } from "react";
import type { Recommendation, RecommendationDecision, RecommendationReviewRecord } from "./types";

/** A recommendation is identified by its alarm's tag AND the
 * excursion it was generated for (`raisedAt`) -- not tag alone. If
 * the same tag alarms again later, that's a new excursion and
 * deserves a fresh review, independent of whatever was decided about
 * the previous one. */
function reviewKey(tag: string, raisedAt: number): string {
  return `${tag}@${raisedAt}`;
}

export interface UseRecommendationReviewResult {
  /** Newest decision first. */
  readonly reviews: readonly RecommendationReviewRecord[];
  readonly recordDecision: (
    recommendation: Recommendation,
    decision: RecommendationDecision,
    now: number,
    note?: string,
  ) => void;
  readonly isReviewed: (tag: string, raisedAt: number) => boolean;
}

export function useRecommendationReview(): UseRecommendationReviewResult {
  const [reviews, setReviews] = useState<readonly RecommendationReviewRecord[]>([]);
  const [reviewedKeys, setReviewedKeys] = useState<ReadonlySet<string>>(new Set());

  const recordDecision = useCallback(
    (recommendation: Recommendation, decision: RecommendationDecision, now: number, note?: string) => {
      const key = reviewKey(recommendation.tag, recommendation.raisedAt);
      setReviewedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      const record: RecommendationReviewRecord = {
        tag: recommendation.tag,
        action: recommendation.action,
        confidence: recommendation.confidence,
        decision,
        reviewedAt: now,
        ...(note ? { note } : {}),
      };
      setReviews((prev) => [record, ...prev]);
    },
    [],
  );

  const isReviewed = useCallback(
    (tag: string, raisedAt: number) => reviewedKeys.has(reviewKey(tag, raisedAt)),
    [reviewedKeys],
  );

  return { reviews, recordDecision, isReviewed };
}
