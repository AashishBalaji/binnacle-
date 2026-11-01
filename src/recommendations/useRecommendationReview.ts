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

/** A recommendation is identified by its alarm's tag, the excursion
 * it was generated for (`raisedAt`), AND the specific action being
 * recommended -- not tag+excursion alone. Keying on tag+excursion
 * only was a real bug: an operator who reasonably rejects an early,
 * low-confidence "Acknowledge" on a fresh alarm would permanently
 * silence that excursion from ever being recommended again -- including
 * a later, genuinely more urgent "Escalate" once the same alarm ages
 * past its escalation threshold. A rejected (or accepted) ACKNOWLEDGE
 * must not suppress a later ESCALATE on the same excursion; only a
 * repeat of the *same* recommendation should stay silenced. This
 * mirrors stage 1's own rule that a SHELVED alarm's suppression never
 * survives a genuinely new fact (a re-trip) -- a review decision here
 * shouldn't survive a genuinely new recommendation either. */
function reviewKey(tag: string, raisedAt: number, action: Recommendation["action"]): string {
  return `${tag}@${raisedAt}:${action}`;
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
  readonly isReviewed: (recommendation: Recommendation) => boolean;
}

export function useRecommendationReview(): UseRecommendationReviewResult {
  const [reviews, setReviews] = useState<readonly RecommendationReviewRecord[]>([]);
  const [reviewedKeys, setReviewedKeys] = useState<ReadonlySet<string>>(new Set());

  const recordDecision = useCallback(
    (recommendation: Recommendation, decision: RecommendationDecision, now: number, note?: string) => {
      const key = reviewKey(recommendation.tag, recommendation.raisedAt, recommendation.action);
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
    (recommendation: Recommendation) =>
      reviewedKeys.has(reviewKey(recommendation.tag, recommendation.raisedAt, recommendation.action)),
    [reviewedKeys],
  );

  return { reviews, recordDecision, isReviewed };
}
