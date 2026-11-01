import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { HandoffPanel } from "./HandoffPanel";

describe("HandoffPanel", () => {
  it("starts in manual control with no accessibility violations", async () => {
    const { container } = render(<HandoffPanel />);
    expect(screen.getByText("Manual control")).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("requesting automation moves to the pending-confirmation state, not straight to automatic", async () => {
    const user = userEvent.setup();
    render(<HandoffPanel />);

    await user.click(screen.getByRole("button", { name: "Request automation takeover" }));

    expect(screen.getByText(/requesting control.*awaiting confirmation/i)).toBeInTheDocument();
  });

  it("confirming grants automatic control, and override is a single immediate action", async () => {
    const user = userEvent.setup();
    render(<HandoffPanel />);

    await user.click(screen.getByRole("button", { name: "Request automation takeover" }));
    await user.click(screen.getByRole("button", { name: /^Confirm/ }));
    expect(screen.getByText("Automatic control")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Override/ }));
    expect(screen.getByText("Manual control")).toBeInTheDocument();
  });

  it("automation ceding control requires an explicit acknowledgment before returning to plain manual", async () => {
    const user = userEvent.setup();
    render(<HandoffPanel />);

    await user.click(screen.getByRole("button", { name: "Request automation takeover" }));
    await user.click(screen.getByRole("button", { name: /^Confirm/ }));
    await user.click(screen.getByRole("button", { name: /cede control/i }));

    expect(screen.getByText(/awaiting acknowledgment/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Acknowledge/ }));
    expect(screen.getByText("Manual control")).toBeInTheDocument();
  });
});
