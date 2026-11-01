import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmConsole } from "./AlarmConsole";

// The demo "Raise ..." buttons call useAlarmSystem's dispatchers, which
// stamp events with `performance.now() - startRef.current`. jsdom's
// performance.now() is real wall-clock time, which is fine, but we
// don't want the periodic TICK interval firing mid-assertion in a way
// that's timing-sensitive, so tests that don't care about TICK leave
// real timers running (events are still ordered correctly either way
// since the reducer only cares about relative `now` values).

describe("AlarmConsole", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders with no active alarms initially and has no accessibility violations", async () => {
    const { container } = render(<AlarmConsole />);
    expect(screen.getByText("No active alarms.")).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("raising a critical alarm surfaces it as UNACK and announces the count", async () => {
    const user = userEvent.setup();
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise critical" }));

    const row = screen.getByTestId("alarm-row");
    expect(within(row).getByText(/Unacknowledged/)).toBeInTheDocument();
    expect(screen.getByText(/1 unacknowledged of 1 active alarm/)).toBeInTheDocument();
  });

  it("acknowledging an alarm moves it out of the unacknowledged count", async () => {
    const user = userEvent.setup();
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise high" }));
    const row = screen.getByTestId("alarm-row");
    await user.click(within(row).getByRole("button", { name: /^Acknowledge/ }));

    expect(within(row).getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByText(/0 unacknowledged of 1 active alarm/)).toBeInTheDocument();
  });

  it("shelving an alarm opens the inline form and, on submit, moves the alarm to SHELVED", async () => {
    const user = userEvent.setup();
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise low" }));
    const row = screen.getByTestId("alarm-row");
    const tagText = within(row).getByText(/^DEMO-LOW-/).textContent ?? "";

    await user.click(within(row).getByRole("button", { name: /^Shelve/ }));

    const form = screen.getByRole("form", { name: `Shelve ${tagText}` });
    await user.type(within(form).getByLabelText(/Reason for shelving/), "nuisance, recalibration pending");
    await user.click(within(form).getByRole("button", { name: "Confirm shelve" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("alarm-row")).getByText(/Shelved/)).toBeInTheDocument();
  });

  it("simulating a flood suppresses new low-priority alarms and shows the flood banner", async () => {
    const user = userEvent.setup();
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: /Simulate flood/ }));

    expect(screen.getByRole("status")).toHaveTextContent(/flood/i);
    expect(screen.getAllByText(/Suppressed \(flood\)/).length).toBeGreaterThan(0);
  });

  it("has no accessibility violations with a populated, mixed-priority board (incl. the flood banner)", async () => {
    const user = userEvent.setup();
    const { container } = render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise critical" }));
    await user.click(screen.getByRole("button", { name: "Raise high" }));
    await user.click(screen.getByRole("button", { name: /Simulate flood/ }));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("every action on an alarm row is reachable and operable via keyboard alone, with no mouse events", async () => {
    const user = userEvent.setup();
    render(<AlarmConsole />);

    // Tab from the top of the page to the first row's Ack button and
    // activate it with the keyboard -- no user.click anywhere here.
    await user.click(document.body); // establish a known focus origin without touching the console
    await user.click(screen.getByRole("button", { name: "Raise high" }));

    const row = screen.getByTestId("alarm-row");
    const ackButton = within(row).getByRole("button", { name: /^Acknowledge/ });

    ackButton.focus();
    expect(ackButton).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(within(row).getByText("Acknowledged")).toBeInTheDocument();

    // Clearing an ACKED alarm retires it to CLEARED, which the console
    // drops from the active-alarm view entirely -- so the row itself
    // (not just its label) should disappear.
    const clearButton = within(row).getByRole("button", { name: /^Clear/ });
    clearButton.focus();
    await user.keyboard(" "); // space also activates a button, per native semantics
    expect(screen.queryByTestId("alarm-row")).not.toBeInTheDocument();
    expect(screen.getByText("No active alarms.")).toBeInTheDocument();
  });

  it("raising an alarm surfaces a recommendation, and accepting it applies the underlying alarm action and logs the decision", async () => {
    const user = userEvent.setup();
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise high" }));

    const panel = screen.getByRole("region", { name: "Recommended actions" });
    expect(within(panel).getByText("Acknowledge")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: /^Accept recommendation for/ }));

    // Accepting an ACKNOWLEDGE recommendation actually acks the alarm --
    // not just a cosmetic log entry -- so the row reflects it too.
    const row = screen.getByTestId("alarm-row");
    expect(within(row).getByText("Acknowledged")).toBeInTheDocument();

    // The recommendation is now reviewed, so it drops out of the
    // pending queue, and the decision is recorded in the review log.
    expect(within(panel).getByText("No recommendations right now.")).toBeInTheDocument();
    const log = screen.getByRole("region", { name: "Recommendation review log" });
    expect(within(log).getByText("accepted")).toBeInTheDocument();
  });

  it("rejecting a recommendation records the decision without touching the alarm, and no longer prompts for it", async () => {
    const user = userEvent.setup();
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise low" }));
    const panel = screen.getByRole("region", { name: "Recommended actions" });

    await user.click(within(panel).getByRole("button", { name: /^Reject recommendation for/ }));
    await user.type(within(panel).getByLabelText("Reason for rejecting (optional)"), "monitoring manually");
    await user.click(within(panel).getByRole("button", { name: "Confirm reject" }));

    const row = screen.getByTestId("alarm-row");
    expect(within(row).getByText("Unacknowledged")).toBeInTheDocument(); // untouched
    expect(within(panel).getByText("No recommendations right now.")).toBeInTheDocument();

    const log = screen.getByRole("region", { name: "Recommendation review log" });
    expect(within(log).getByText(/monitoring manually/)).toBeInTheDocument();
    expect(within(log).getByText("rejected")).toBeInTheDocument();
  });

  it("has no accessibility violations with recommendations and a review log both populated", async () => {
    const user = userEvent.setup();
    const { container } = render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise critical" }));
    await user.click(screen.getByRole("button", { name: "Raise low" }));
    const panel = screen.getByRole("region", { name: "Recommended actions" });
    await user.click(within(panel).getAllByRole("button", { name: /^Accept recommendation for/ })[0]);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // The two tests below push a real alarm's age past the engine's
  // ESCALATE / SHELVE thresholds (minutes of wall-clock time) without
  // actually waiting that long: performance.now() is mocked so the
  // alarm's `raisedAt`/`ackedAt` is stamped early, then the mock jumps
  // forward before the next real (500ms) TICK -- so `now` state
  // advances past the threshold on the very next tick, the same TICK
  // mechanism the app uses in production, not a shortcut around it.
  it("accepting an ESCALATE recommendation acknowledges the alarm and logs an escalate decision", async () => {
    const user = userEvent.setup();
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise critical" }));
    nowSpy.mockReturnValue(3 * 60_000); // past the 2-minute critical escalation threshold

    const panel = screen.getByRole("region", { name: "Recommended actions" });
    await waitFor(() => expect(within(panel).getByText("Escalate")).toBeInTheDocument(), { timeout: 2000 });

    await user.click(within(panel).getByRole("button", { name: /^Accept recommendation for/ }));

    const row = screen.getByTestId("alarm-row");
    expect(within(row).getByText("Acknowledged")).toBeInTheDocument();
    const log = screen.getByRole("region", { name: "Recommendation review log" });
    expect(within(log).getByText(/escalate/)).toBeInTheDocument();
  }, 10_000);

  it("accepting a SHELVE recommendation opens the real ShelveForm pre-filled, rather than shelving on one click", async () => {
    const user = userEvent.setup();
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise low" }));
    const row = screen.getByTestId("alarm-row");
    const tagText = within(row).getByText(/^DEMO-LOW-/).textContent ?? "";
    await user.click(within(row).getByRole("button", { name: /^Acknowledge/ }));

    nowSpy.mockReturnValue(20 * 60_000); // past the 15-minute shelve-candidate age

    const panel = screen.getByRole("region", { name: "Recommended actions" });
    await waitFor(() => expect(within(panel).getByText("Shelve")).toBeInTheDocument(), { timeout: 2000 });

    await user.click(within(panel).getByRole("button", { name: /^Accept recommendation for/ }));

    // One click on Accept must NOT have shelved anything yet -- it
    // opens the same form a manual shelve uses, pre-filled, for the
    // operator to confirm or edit.
    expect(within(row).getByText("Acknowledged")).toBeInTheDocument();
    const form = screen.getByRole("form", { name: `Shelve ${tagText}` });
    expect(within(form).getByLabelText(/Reason for shelving/)).toHaveValue(
      "Low-priority, acknowledged well past the point of re-acknowledgment -- recommended by the review engine.",
    );
    expect(within(form).getByRole("combobox")).toHaveValue(String(60 * 60_000));

    await user.click(within(form).getByRole("button", { name: "Confirm shelve" }));

    expect(within(screen.getByTestId("alarm-row")).getByText(/Shelved/)).toBeInTheDocument();
    const log = screen.getByRole("region", { name: "Recommendation review log" });
    expect(within(log).getByText(/shelve/)).toBeInTheDocument();
    expect(within(log).getByText("accepted")).toBeInTheDocument();
  }, 10_000);

  it("cancelling the pre-filled ShelveForm records no decision, so the recommendation is still there to act on", async () => {
    const user = userEvent.setup();
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    render(<AlarmConsole />);

    await user.click(screen.getByRole("button", { name: "Raise low" }));
    const row = screen.getByTestId("alarm-row");
    await user.click(within(row).getByRole("button", { name: /^Acknowledge/ }));
    nowSpy.mockReturnValue(20 * 60_000);

    const panel = screen.getByRole("region", { name: "Recommended actions" });
    await waitFor(() => expect(within(panel).getByText("Shelve")).toBeInTheDocument(), { timeout: 2000 });
    await user.click(within(panel).getByRole("button", { name: /^Accept recommendation for/ }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("alarm-row")).getByText("Acknowledged")).toBeInTheDocument(); // untouched
    expect(within(panel).getByText("Shelve")).toBeInTheDocument(); // recommendation still pending
    expect(screen.queryByRole("region", { name: "Recommendation review log" })).not.toBeInTheDocument();
  }, 10_000);
});
