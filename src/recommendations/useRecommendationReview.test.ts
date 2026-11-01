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
    expect(result.current.isReviewed("TT-1", 0)).toBe(false);
  });

  it("records an accepted decision and marks the excursion reviewed", () => {
    const { result } = renderHook(() => useRecommendationReview());
    act(() => result.current.recordDecision(makeRecommendation(), "accepted", 1_000));

    expect(result.current.isReviewed("TT-1", 0)).toBe(true);
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

    expect(result.current.isReviewed("TT-1", 0)).toBe(true);
    expect(result.current.isReviewed("TT-1", 5_000)).toBe(false);
  });

  it("keeps newest decision first in the log", () => {
    const { result } = renderHook(() => useRecommendationReview());
    act(() => result.current.recordDecision(makeRecommendation({ tag: "A" }), "accepted", 1_000));
    act(() => result.current.recordDecision(makeRecommendation({ tag: "B" }), "rejected", 2_000));

    expect(result.current.reviews.map((r) => r.tag)).toEqual(["B", "A"]);
  });
});
