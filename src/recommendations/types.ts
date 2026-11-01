/**
 * types.ts -- the vocabulary for stage 3: explainable recommended
 * actions for alarms that need operator attention.
 *
 * "Explainable" here means literally inspectable, not just a buzzword:
 * a Recommendation is never a bare score. It always carries the
 * `factors` that produced it -- the same rule-based weights
 * `engine.ts` summed to reach `confidence` -- so an operator (or a
 * reviewer of this project) can see exactly why a given action was
 * suggested, not just that it was. There is no ML model and no
 * opaque black box anywhere in this stage; see engine.ts's docstring
 * for why that's a deliberate choice, not a shortcut.
 */

import type { AlarmPriority } from "../alarms/types";

/** The three actions this engine will ever recommend. Each maps onto
 * an action the operator could already take from the alarm console
 * itself (ack.../shelve...) except ESCALATE, which has no real
 * escalation/paging system behind it in this project -- accepting an
 * ESCALATE recommendation acknowledges the alarm and records the
 * escalation decision in the review log, nothing more. See
 * README.md's scope section. */
export type RecommendedAction = "ACKNOWLEDGE" | "SHELVE" | "ESCALATE";

/** One contributing signal behind a recommendation's confidence.
 * `weight` is this factor's own contribution, 0-1 -- a recommendation's
 * `confidence` is the (clamped) sum of its factors' weights, so the
 * breakdown an operator sees always adds up to the number they're
 * being asked to trust. */
export interface RecommendationFactor {
  readonly label: string;
  readonly weight: number;
  readonly detail: string;
}

export interface Recommendation {
  readonly tag: string;
  readonly action: RecommendedAction;
  /** 0-1, the clamped sum of `factors[].weight`. */
  readonly confidence: number;
  /** One-line plain-English summary, e.g. "Critical alarm open 3m 10s
   * without acknowledgment." */
  readonly rationale: string;
  readonly factors: readonly RecommendationFactor[];
  /** Identifies which excursion this recommendation is for -- the
   * alarm instance's `raisedAt`. A new RAISE on the same tag starts a
   * fresh excursion and should be reviewed fresh, independent of a
   * decision made on the previous one. */
  readonly raisedAt: number;
  readonly generatedAt: number;
  /** Both only present when action === "SHELVE". These pre-fill the
   * real ShelveForm (AlarmConsole.tsx) rather than being applied
   * silently -- accepting a SHELVE recommendation opens that form
   * with these as the starting, still-editable values, the same
   * confirmation step a manually-initiated shelve already requires. */
  readonly suggestedShelveDurationMs?: number;
  readonly suggestedShelveReason?: string;
  readonly priority: AlarmPriority;
}

export type RecommendationDecision = "accepted" | "rejected";

/** One entry in the in-memory review log -- see useRecommendationReview.ts.
 * This is NOT an ISA-18.2 audit journal (stage 1's README explicitly
 * scopes that out); it exists only so an operator (or a reviewer of
 * this project) can see what was reviewed and why, for as long as the
 * page stays open. */
export interface RecommendationReviewRecord {
  readonly tag: string;
  readonly action: RecommendedAction;
  readonly confidence: number;
  readonly decision: RecommendationDecision;
  readonly reviewedAt: number;
  readonly note?: string;
}
