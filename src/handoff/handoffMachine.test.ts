import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import { AUTOMATION_HANDOFF_TIMEOUT_MS, MANUAL_HANDBACK_TIMEOUT_MS, handoffMachine } from "./handoffMachine";

function actorAt(events: Array<Parameters<ReturnType<typeof createActor>["send"]>[0]>) {
  const actor = createActor(handoffMachine);
  actor.start();
  for (const event of events) actor.send(event);
  return actor;
}

describe("handoff: operator confirms an automation request", () => {
  it("starts in manual", () => {
    expect(actorAt([]).getSnapshot().value).toBe("manual");
  });

  it("an automation request moves to automationPending, not straight to automatic", () => {
    // The core mode-confusion-prevention property: automation can
    // never take control in a single step.
    const actor = actorAt([{ type: "AUTOMATION_REQUEST", now: 0 }]);
    expect(actor.getSnapshot().value).toBe("automationPending");
  });

  it("OPERATOR_CONFIRM during a pending request grants automatic control", () => {
    const actor = actorAt([{ type: "AUTOMATION_REQUEST", now: 0 }, { type: "OPERATOR_CONFIRM" }]);
    expect(actor.getSnapshot().value).toBe("automatic");
  });

  it("OPERATOR_REJECT during a pending request keeps the operator in control", () => {
    const actor = actorAt([{ type: "AUTOMATION_REQUEST", now: 0 }, { type: "OPERATOR_REJECT" }]);
    expect(actor.getSnapshot().value).toBe("manual");
  });

  it("an unanswered automation request times out back to manual, the safe default", () => {
    const actor = actorAt([
      { type: "AUTOMATION_REQUEST", now: 0 },
      { type: "TICK", now: AUTOMATION_HANDOFF_TIMEOUT_MS + 1 },
    ]);
    expect(actor.getSnapshot().value).toBe("manual");
  });

  it("a TICK before the timeout elapses leaves the request pending", () => {
    const actor = actorAt([
      { type: "AUTOMATION_REQUEST", now: 0 },
      { type: "TICK", now: AUTOMATION_HANDOFF_TIMEOUT_MS - 1 },
    ]);
    expect(actor.getSnapshot().value).toBe("automationPending");
  });
});

describe("handoff: operator override is always immediate", () => {
  it("MANUAL_OVERRIDE from automatic returns control in one step, no confirmation needed", () => {
    const actor = actorAt([
      { type: "AUTOMATION_REQUEST", now: 0 },
      { type: "OPERATOR_CONFIRM" },
      { type: "MANUAL_OVERRIDE" },
    ]);
    expect(actor.getSnapshot().value).toBe("manual");
  });
});

describe("handoff: automation ceding control requires operator acknowledgment", () => {
  function inAutomatic() {
    return actorAt([{ type: "AUTOMATION_REQUEST", now: 0 }, { type: "OPERATOR_CONFIRM" }]);
  }

  it("AUTOMATION_CEDE moves to manualPending, not straight back to manual", () => {
    const actor = inAutomatic();
    actor.send({ type: "AUTOMATION_CEDE", now: 100 });
    expect(actor.getSnapshot().value).toBe("manualPending");
  });

  it("OPERATOR_ACK during the handback window returns to ordinary manual control", () => {
    const actor = inAutomatic();
    actor.send({ type: "AUTOMATION_CEDE", now: 100 });
    actor.send({ type: "OPERATOR_ACK" });
    expect(actor.getSnapshot().value).toBe("manual");
  });

  it("an unacknowledged handback times out to FAILSAFE -- the dangerous case is loud, not silent", () => {
    const actor = inAutomatic();
    actor.send({ type: "AUTOMATION_CEDE", now: 100 });
    actor.send({ type: "TICK", now: 100 + MANUAL_HANDBACK_TIMEOUT_MS + 1 });
    expect(actor.getSnapshot().value).toBe("failsafe");
  });

  it("FAILSAFE requires an explicit OPERATOR_ACK to clear, then resumes manual", () => {
    const actor = inAutomatic();
    actor.send({ type: "AUTOMATION_CEDE", now: 100 });
    actor.send({ type: "TICK", now: 100 + MANUAL_HANDBACK_TIMEOUT_MS + 1 });
    actor.send({ type: "OPERATOR_ACK" });
    expect(actor.getSnapshot().value).toBe("manual");
  });
});
