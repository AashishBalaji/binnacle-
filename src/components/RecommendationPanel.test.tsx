import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { RecommendationPanel } from "./RecommendationPanel";
import type { Recommendation } from "../recommendations/types";

function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    tag: "TT-204",
    action: "ACKNOWLEDGE",
    confidence: 0.72,
    rationale: "High alarm unacknowledged for 3m 0s.",
    factors: [
      { label: "Priority", weight: 0.3, detail: "High priority alarm." },
      { label: "Time unacknowledged", weight: 0.42, detail: "Unacknowledged for 3m 0s." },
    ],
    raisedAt: 0,
    generatedAt: 0,
    priority: "high",
    ...overrides,
  };
}

describe("RecommendationPanel", () => {
  it("shows an empty state with no accessibility violations when there's nothing to review", async () => {
    const { container } = render(
      <RecommendationPanel recommendations={[]} now={0} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={vi.fn<(recommendation: Recommendation, note?: string) => void>()} />,
    );
    expect(screen.getByText("No recommendations right now.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders a recommendation with its action, score, and rationale, with no accessibility violations", async () => {
    const { container } = render(
      <RecommendationPanel recommendations={[makeRecommendation()]} now={1_000} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={vi.fn<(recommendation: Recommendation, note?: string) => void>()} />,
    );
    expect(screen.getByText("TT-204")).toBeInTheDocument();
    expect(screen.getByText("Acknowledge")).toBeInTheDocument();
    expect(screen.getByText("72% score")).toBeInTheDocument();
    expect(screen.getByText("High alarm unacknowledged for 3m 0s.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never renders the word 'confidence' -- a rule-based score must not read as a calibrated probability", () => {
    // Regression test for the round-table finding: the rendered page,
    // not just engine.ts's docstring, must carry forward that this is
    // a hand-weighted rule sum, not model output. Checking the whole
    // container's text content (not a specific node) is deliberate --
    // this should hold no matter where the word might sneak back in.
    const { container } = render(
      <RecommendationPanel recommendations={[makeRecommendation()]} now={1_000} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={vi.fn<(recommendation: Recommendation, note?: string) => void>()} />,
    );
    expect(container.textContent?.toLowerCase()).not.toContain("confidence");
  });

  it("shows a visible disclosure that scores are rule-based, without needing to open any disclosure triangle", () => {
    render(
      <RecommendationPanel recommendations={[makeRecommendation()]} now={1_000} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={vi.fn<(recommendation: Recommendation, note?: string) => void>()} />,
    );
    expect(screen.getByText(/Rule-based scores, not predictions from a trained model/)).toBeVisible();
  });

  it("the Why disclosure reveals the actual weighted factors, not just the score", async () => {
    const user = userEvent.setup();
    render(<RecommendationPanel recommendations={[makeRecommendation()]} now={0} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={vi.fn<(recommendation: Recommendation, note?: string) => void>()} />);

    expect(screen.queryByText("High priority alarm.")).not.toBeVisible();
    await user.click(screen.getByText("Why?"));
    expect(screen.getByText("High priority alarm.")).toBeVisible();
    expect(screen.getByText("Unacknowledged for 3m 0s.")).toBeVisible();
  });

  it("accepting calls onAccept with the recommendation", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn<(recommendation: Recommendation) => void>();
    const rec = makeRecommendation();
    render(<RecommendationPanel recommendations={[rec]} now={0} onAccept={onAccept} onReject={vi.fn<(recommendation: Recommendation, note?: string) => void>()} />);

    await user.click(screen.getByRole("button", { name: "Accept recommendation for TT-204" }));
    expect(onAccept).toHaveBeenCalledWith(rec);
  });

  it("rejecting opens an inline note field and calls onReject with the trimmed note on confirm", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn<(recommendation: Recommendation, note?: string) => void>();
    const rec = makeRecommendation();
    render(<RecommendationPanel recommendations={[rec]} now={0} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={onReject} />);

    await user.click(screen.getByRole("button", { name: "Reject recommendation for TT-204" }));
    await user.type(screen.getByLabelText("Reason for rejecting (optional)"), "  already handled  ");
    await user.click(screen.getByRole("button", { name: "Confirm reject" }));

    expect(onReject).toHaveBeenCalledWith(rec, "already handled");
  });

  it("rejecting with no note passes undefined, not an empty string", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn<(recommendation: Recommendation, note?: string) => void>();
    const rec = makeRecommendation();
    render(<RecommendationPanel recommendations={[rec]} now={0} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={onReject} />);

    await user.click(screen.getByRole("button", { name: "Reject recommendation for TT-204" }));
    await user.click(screen.getByRole("button", { name: "Confirm reject" }));

    expect(onReject).toHaveBeenCalledWith(rec, undefined);
  });

  it("cancelling the reject form hides it without calling onReject", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn<(recommendation: Recommendation, note?: string) => void>();
    render(<RecommendationPanel recommendations={[makeRecommendation()]} now={0} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={onReject} />);

    await user.click(screen.getByRole("button", { name: "Reject recommendation for TT-204" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reject recommendation for TT-204" })).toBeInTheDocument();
  });

  it("renders multiple recommendations, each independently actionable", async () => {
    const recA = makeRecommendation({ tag: "A", raisedAt: 0 });
    const recB = makeRecommendation({ tag: "B", raisedAt: 10, action: "SHELVE" });
    const { container } = render(
      <RecommendationPanel recommendations={[recA, recB]} now={0} onAccept={vi.fn<(recommendation: Recommendation) => void>()} onReject={vi.fn<(recommendation: Recommendation, note?: string) => void>()} />,
    );
    expect(screen.getAllByTestId("recommendation-item")).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
  });
});
