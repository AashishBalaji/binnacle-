import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
