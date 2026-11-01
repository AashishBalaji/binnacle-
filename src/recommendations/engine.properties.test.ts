/**
 * engine.properties.test.ts -- generative proof of this engine's
 * explainability contract, not just hand-picked examples, the same
 * discipline as src/alarms/lifecycle.properties.test.ts.
 *
 * Invariant 1 (confidence is bounded): every recommendation's
 * confidence is in [0, 1], for any board the engine can be fed.
 *
 * Invariant 2 (every recommendation explains itself): every
 * recommendation carries at least one factor, and those factors'
 * weights always sum to exactly its confidence (modulo the same
 * clamp applied to both) -- the UI can never show a number with no
 * backing reasoning.
 *
 * Invariant 3 (severity gates escalation): ESCALATE is never
 * recommended for a LOW priority alarm, however old -- mirroring
 * lifecycle.ts's own "flood suppression never touches high/critical"
 * invariant, in the opposite direction.
 *
 * Invariant 4 (hidden/settled states get no opinion): SHELVED,
 * SUPPRESSED, and CLEARED alarms never produce a recommendation.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateRecommendations } from "./engine";
import type { AlarmBoard, AlarmInstance, AlarmPriority, AlarmState } from "../alarms/types";

const TAGS = ["TT-1", "TT-2", "TT-3", "TT-4"] as const;
const PRIORITIES: AlarmPriority[] = ["critical", "high", "low"];
const STATES: AlarmState[] = ["UNACK", "ACKED", "RTN_UNACK", "SHELVED", "SUPPRESSED", "CLEARED"];

const instanceArbitrary: fc.Arbitrary<AlarmInstance> = fc
  .record({
    tag: fc.constantFrom(...TAGS),
    priority: fc.constantFrom(...PRIORITIES),
    state: fc.constantFrom(...STATES),
    raisedAt: fc.integer({ min: 0, max: 1_000_000 }),
    ackOffset: fc.integer({ min: 0, max: 100_000 }),
    clearOffset: fc.integer({ min: 0, max: 100_000 }),
  })
  .map(({ tag, priority, state, raisedAt, ackOffset, clearOffset }) => {
    const needsAck = state === "ACKED";
    const needsClear = state === "RTN_UNACK";
    const instance: AlarmInstance = {
      tag,
      priority,
      state,
      raisedAt,
      description: `${tag} synthetic test alarm`,
      ...(needsAck ? { ackedAt: raisedAt + ackOffset } : {}),
      ...(needsClear ? { clearedAt: raisedAt + clearOffset } : {}),
      ...(state === "SHELVED"
        ? { shelf: { reason: "test", shelvedAt: raisedAt, expiresAt: raisedAt + 1_000_000 } }
        : {}),
    };
    return instance;
  });

const boardArbitrary: fc.Arbitrary<AlarmBoard> = fc
  .uniqueArray(instanceArbitrary, { selector: (i) => i.tag })
  .map((instances) => new Map(instances.map((i) => [i.tag, i] as const)));

const nowArbitrary = fc.integer({ min: 1_000_000, max: 3_000_000 }); // always after every raisedAt above

describe("recommendation engine invariants", () => {
  it("confidence is always within [0, 1]", () => {
    fc.assert(
      fc.property(boardArbitrary, nowArbitrary, (board, now) => {
        for (const rec of generateRecommendations(board, now)) {
          expect(rec.confidence).toBeGreaterThanOrEqual(0);
          expect(rec.confidence).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("every recommendation has at least one factor, and the factors' weights sum to its confidence", () => {
    fc.assert(
      fc.property(boardArbitrary, nowArbitrary, (board, now) => {
        for (const rec of generateRecommendations(board, now)) {
          expect(rec.factors.length).toBeGreaterThan(0);
          const sum = rec.factors.reduce((s, f) => s + f.weight, 0);
          // Both the raw sum and the stored confidence go through the
          // same clamp -- if confidence is unclamped (the normal
          // case), these are exactly equal, not just close.
          const clamped = Math.max(0, Math.min(1, sum));
          expect(rec.confidence).toBeCloseTo(clamped, 10);
        }
      }),
    );
  });

  it("ESCALATE is never recommended for a LOW priority alarm", () => {
    fc.assert(
      fc.property(boardArbitrary, nowArbitrary, (board, now) => {
        for (const rec of generateRecommendations(board, now)) {
          // Implication as a boolean, checked unconditionally -- same
          // style as lifecycle.properties.test.ts -- so a run that
          // never generates a LOW recommendation still exercises the
          // assertion rather than silently skipping it.
          const neverEscalatesLow = rec.priority !== "low" || rec.action !== "ESCALATE";
          expect(neverEscalatesLow).toBe(true);
        }
      }),
    );
  });

  it("SHELVED, SUPPRESSED, and CLEARED alarms never receive a recommendation", () => {
    fc.assert(
      fc.property(boardArbitrary, nowArbitrary, (board, now) => {
        const recommendedTags = new Set(generateRecommendations(board, now).map((r) => r.tag));
        for (const inst of board.values()) {
          const settledOrHidden = inst.state === "SHELVED" || inst.state === "SUPPRESSED" || inst.state === "CLEARED";
          const neverRecommendedWhenSettledOrHidden = !settledOrHidden || !recommendedTags.has(inst.tag);
          expect(neverRecommendedWhenSettledOrHidden).toBe(true);
        }
      }),
    );
  });
});
