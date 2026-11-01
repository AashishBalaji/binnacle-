/**
 * engine.ts -- stage 3's "AI": a deterministic, rule-based scoring
 * function, not a trained model.
 *
 * That's a deliberate choice, not a limitation papered over. The
 * stage is called "explainable-AI recommendation review," and the
 * only way to make a recommendation genuinely inspectable -- not just
 * labeled as such -- is for its reasoning to actually be a short list
 * of named, weighted rules an operator can read and verify, the same
 * way `lifecycle.ts`'s reducer is provably correct because it's a
 * pure function rather than a black box. A real industrial alarm-
 * prioritization system might use a trained model; this project
 * demonstrates the review/explainability UI pattern around one,
 * using rules in place of a model so nothing here is dressed up as
 * more than it is. See README.md's scope section.
 *
 * `generateRecommendations` is a pure function of (board, now) --
 * same discipline as `reduceAlarm`: never reads the real clock, never
 * touches the network, fully replayable and property-testable.
 */

import type { AlarmBoard, AlarmInstance, AlarmPriority } from "../alarms/types";
import type { Recommendation, RecommendationFactor, RecommendedAction } from "./types";

const PRIORITY_LABEL: Record<AlarmPriority, string> = {
  critical: "Critical",
  high: "High",
  low: "Low",
};

/** Each priority's flat contribution to confidence -- how much the
 * alarm's own severity alone should move an operator to act, before
 * timing is even considered. */
const PRIORITY_WEIGHT: Record<AlarmPriority, number> = {
  critical: 0.45,
  high: 0.3,
  low: 0.15,
};

/** How long an UNACK alarm of this priority can sit unacknowledged
 * before this engine recommends ESCALATE instead of plain ACKNOWLEDGE.
 * LOW has no entry: a low-priority alarm is never recommended for
 * escalation, mirroring stage 1's rule that flood suppression never
 * touches high/critical -- severity gates what the system is allowed
 * to treat as urgent, in both directions. */
const ESCALATE_AGE_MS: Partial<Record<AlarmPriority, number>> = {
  critical: 2 * 60_000,
  high: 5 * 60_000,
};

const ACK_AGE_MAX_WEIGHT = 0.4;
/** Reference window for the "time unacknowledged" factor on a LOW
 * priority alarm, which has no escalation deadline to measure against. */
const ACK_URGENCY_REFERENCE_MS = 5 * 60_000;

const RTN_UNACK_BASE_WEIGHT = 0.6;
const RTN_UNACK_AGE_MAX_WEIGHT = 0.3;
const RTN_UNACK_AGE_REFERENCE_MS = 5 * 60_000;

/** An ACKED, LOW priority alarm still active this long after
 * acknowledgment is treated as a shelving candidate rather than
 * something waiting on a second ack -- the classic ISA-18.2 "nuisance
 * alarm" pattern. */
export const SHELVE_CANDIDATE_AGE_MS = 15 * 60_000;
const SHELVE_BASE_WEIGHT = 0.5;
const SHELVE_AGE_MAX_WEIGHT = 0.3;
const SHELVE_AGE_REFERENCE_MS = 30 * 60_000;
/** Default shelve duration suggested alongside a SHELVE recommendation
 * -- applied as-is if the operator accepts without editing it. */
export const SUGGESTED_SHELVE_DURATION_MS = 30 * 60_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Linear ramp from 0 to `maxWeight` as `age` goes from 0 to
 * `referenceMs`, then flat at `maxWeight` -- the simplest honest way
 * to turn "how overdue is this" into a bounded factor weight. */
function ageWeight(age: number, referenceMs: number, maxWeight: number): number {
  return clamp01(age / referenceMs) * maxWeight;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function buildRecommendation(
  inst: AlarmInstance,
  now: number,
  action: RecommendedAction,
  rationale: string,
  factors: readonly RecommendationFactor[],
  suggestedShelveDurationMs?: number,
): Recommendation {
  const confidence = clamp01(factors.reduce((sum, f) => sum + f.weight, 0));
  return {
    tag: inst.tag,
    action,
    confidence,
    rationale,
    factors,
    raisedAt: inst.raisedAt,
    generatedAt: now,
    priority: inst.priority,
    ...(suggestedShelveDurationMs !== undefined ? { suggestedShelveDurationMs } : {}),
  };
}

function recommendForUnack(inst: AlarmInstance, now: number): Recommendation {
  const age = now - inst.raisedAt;
  const priorityWeight = PRIORITY_WEIGHT[inst.priority];
  const escalateThreshold = ESCALATE_AGE_MS[inst.priority];
  const timeWeight =
    escalateThreshold !== undefined
      ? ageWeight(age, escalateThreshold, ACK_AGE_MAX_WEIGHT)
      : ageWeight(age, ACK_URGENCY_REFERENCE_MS, ACK_AGE_MAX_WEIGHT);

  const factors: RecommendationFactor[] = [
    { label: "Priority", weight: priorityWeight, detail: `${PRIORITY_LABEL[inst.priority]} priority alarm.` },
    { label: "Time unacknowledged", weight: timeWeight, detail: `Unacknowledged for ${formatDuration(age)}.` },
  ];

  if (escalateThreshold !== undefined && age >= escalateThreshold) {
    return buildRecommendation(
      inst,
      now,
      "ESCALATE",
      `${PRIORITY_LABEL[inst.priority]} alarm open ${formatDuration(age)} without acknowledgment -- past the ${formatDuration(escalateThreshold)} escalation guideline.`,
      factors,
    );
  }

  return buildRecommendation(
    inst,
    now,
    "ACKNOWLEDGE",
    `${PRIORITY_LABEL[inst.priority]} alarm unacknowledged for ${formatDuration(age)}.`,
    factors,
  );
}

function recommendForRtnUnack(inst: AlarmInstance, now: number): Recommendation {
  const since = inst.clearedAt ?? inst.raisedAt;
  const age = now - since;
  const factors: RecommendationFactor[] = [
    {
      label: "Condition cleared, unacknowledged",
      weight: RTN_UNACK_BASE_WEIGHT,
      detail: "Process condition returned to normal, but this excursion was never acknowledged while active.",
    },
    {
      label: "Time since clearing",
      weight: ageWeight(age, RTN_UNACK_AGE_REFERENCE_MS, RTN_UNACK_AGE_MAX_WEIGHT),
      detail: `Cleared ${formatDuration(age)} ago, still unacknowledged.`,
    },
  ];
  return buildRecommendation(
    inst,
    now,
    "ACKNOWLEDGE",
    `Condition cleared ${formatDuration(age)} ago but was never acknowledged -- close out the record.`,
    factors,
  );
}

function recommendForAcked(inst: AlarmInstance, now: number): Recommendation | undefined {
  if (inst.priority !== "low") return undefined;
  const ackedAt = inst.ackedAt ?? inst.raisedAt;
  const age = now - ackedAt;
  if (age < SHELVE_CANDIDATE_AGE_MS) return undefined;

  const factors: RecommendationFactor[] = [
    {
      label: "Low priority, open after acknowledgment",
      weight: SHELVE_BASE_WEIGHT,
      detail: "Low-priority alarm that's stayed active well past acknowledgment -- a shelving candidate, not a repeat ack.",
    },
    {
      label: "Time open since acknowledgment",
      weight: ageWeight(age - SHELVE_CANDIDATE_AGE_MS, SHELVE_AGE_REFERENCE_MS, SHELVE_AGE_MAX_WEIGHT),
      detail: `Acknowledged ${formatDuration(age)} ago, still active.`,
    },
  ];
  return buildRecommendation(
    inst,
    now,
    "SHELVE",
    `Low-priority alarm acknowledged ${formatDuration(age)} ago and still active -- consider shelving to reduce clutter.`,
    factors,
    SUGGESTED_SHELVE_DURATION_MS,
  );
}

/** Dispatches on lifecycle state. SHELVED and CLEARED alarms need no
 * review (CLEARED is retired; SHELVED is the operator's own standing
 * decision, which this engine doesn't second-guess). SUPPRESSED
 * alarms aren't surfaced to the operator at all during a flood (stage
 * 1's deliberate scope), so recommending action on something they
 * can't currently see would be reasoning about a hidden state --
 * out of scope here too. */
function recommendFor(inst: AlarmInstance, now: number): Recommendation | undefined {
  switch (inst.state) {
    case "UNACK":
      return recommendForUnack(inst, now);
    case "RTN_UNACK":
      return recommendForRtnUnack(inst, now);
    case "ACKED":
      return recommendForAcked(inst, now);
    case "SUPPRESSED":
    case "SHELVED":
    case "CLEARED":
      return undefined;
    default: {
      const _exhaustive: never = inst.state;
      return _exhaustive;
    }
  }
}

const PRIORITY_RANK: Record<AlarmPriority, number> = { critical: 0, high: 1, low: 2 };

/** Worst-first, same ordering convention as AlarmConsole's own sort:
 * priority, then confidence (how sure the engine is), then tag for a
 * stable tie-break. */
function sortRecommendations(recs: readonly Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => {
    const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDelta !== 0) return priorityDelta;
    const confidenceDelta = b.confidence - a.confidence;
    if (confidenceDelta !== 0) return confidenceDelta;
    return a.tag.localeCompare(b.tag);
  });
}

export function generateRecommendations(board: AlarmBoard, now: number): readonly Recommendation[] {
  const recs: Recommendation[] = [];
  for (const inst of board.values()) {
    const rec = recommendFor(inst, now);
    if (rec) recs.push(rec);
  }
  return sortRecommendations(recs);
}
