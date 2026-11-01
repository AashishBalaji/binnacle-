import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRecommendationReview } from "./useRecommendationReview";
import type { Recommendation } from "./types";

function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    tag: "TT-1",
    action: "ACKNOWLEDGE",
    confidence: 0.5,
    rationale: "test",
    factors: [{ label: "Priority", weight: 0.5, detail: "test" }],
    raisedAt: 0,
    generatedAt: 0,
    priority: "high",
    ...overrides,
  };
}

describe("useRecommendationReview", () => {
  it("starts with nothing reviewed", () => {
    const { result } = renderHook(() => useRecommendationReview());
    expect(result.current.reviews).toEqual([]);
    expect(result.current.isReviewed(makeRecommendation())).toBe(false);
  });

  it("records an accepted decision and marks that recommendation reviewed", () => {
    const { result } = renderHook(() => useRecommendationReview());
    const rec = makeRecommendation();
    act(() => result.current.recordDecision(rec, "accepted", 1_000));

    expect(result.current.isReviewed(rec)).toBe(true);
    expect(result.current.reviews).toHaveLength(1);
    expect(result.current.reviews[0]).toMatchObject({
      tag: "TT-1",
      action: "ACKNOWLEDGE",
      decision: "accepted",
      reviewedAt: 1_000,
    });
  });

  it("records a rejected decision with an optional note", () => {
    const { result } = renderHook(() => useRecommendationReview());
    act(() => result.current.recordDecision(makeRecommendation(), "rejected", 2_000, "already investigating"));

    expect(result.current.reviews[0]).toMatchObject({ decision: "rejected", note: "already investigating" });
  });

  it("a fresh excursion on the same tag (new raisedAt) is NOT already reviewed", () => {
    const { result } = renderHook(() => useRecommendationReview());
    act(() => result.current.recordDecision(makeRecommendation({ raisedAt: 0 }), "accepted", 1_000));

    expect(result.current.isReviewed(makeRecommendation({ raisedAt: 0 }))).toBe(true);
    expect(result.current.isReviewed(makeRecommendation({ raisedAt: 5_000 }))).toBe(false);
  });

  it("a DIFFERENT action on the SAME excursion is NOT already reviewed -- the bug this hook used to have", () => {
    // Regression test for the round-table finding: rejecting an early,
    // low-confidence ACKNOWLEDGE on a fresh alarm must not permanently
    // silence that excursion -- a later, genuinely more urgent ESCALATE
    // on the same tag/raisedAt still needs to be shown and reviewed on
    // its own, exactly as if nothing had been decided before.
    const { result } = renderHook(() => useRecommendationReview());
    const ackRec = makeRecommendation({ tag: "TT-204", raisedAt: 0, action: "ACKNOWLEDGE" });
    act(() => result.current.recordDecision(ackRec, "rejected", 1_000));

    expect(result.current.isReviewed(ackRec)).toBe(true);

    const escalateRec = makeRecommendation({ tag: "TT-204", raisedAt: 0, action: "ESCALATE" });
    expect(result.current.isReviewed(escalateRec)).toBe(false);
  });

  it("re-recommending the SAME action on the SAME excursion stays reviewed (no repeat prompt)", () => {
    const { result } = renderHook(() => useRecommendationReview());
    const rec = makeRecommendation({ tag: "TT-1", raisedAt: 0, action: "ACKNOWLEDGE", confidence: 0.3 });
    act(() => result.current.recordDecision(rec, "rejected", 1_000));

    // Same tag, same excursion, same action -- just a later, higher
    // confidence snapshot of the same recommendation. Still reviewed.
    const laterSameAction = makeRecommendation({ tag: "TT-1", raisedAt: 0, action: "ACKNOWLEDGE", confidence: 0.6 });
    expect(result.current.isReviewed(laterSameAction)).toBe(true);
  });

  it("keeps newest decision first in the log", () => {
    const { result } = renderHook(() => useRecommendationReview());
    act(() => result.current.recordDecision(makeRecommendation({ tag: "A" }), "accepted", 1_000));
    act(() => result.current.recordDecision(makeRecommendation({ tag: "B" }), "rejected", 2_000));

    expect(result.current.reviews.map((r) => r.tag)).toEqual(["B", "A"]);
  });
});
