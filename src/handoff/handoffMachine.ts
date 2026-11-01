/**
 * handoffMachine.ts -- stage 2: a mode-confusion-safe operator/
 * automation handoff, modeled as an XState machine.
 *
 * Mode confusion (the operator and the automation disagreeing about
 * who is actually in control) is a documented contributing factor in
 * real incidents -- Air France 447 and Three Mile Island are the
 * usual citations. The specific failure this machine is built to
 * rule out: automation silently taking control without an explicit
 * operator confirmation, and the reverse -- automation handing
 * control back without anyone confirming the operator is actually
 * paying attention again.
 *
 * Five states, each meant to be visually unambiguous on its own:
 *
 *   MANUAL              -- operator has control (the baseline/safe state)
 *   AUTOMATION_PENDING   -- automation has REQUESTED control; operator
 *                          must explicitly confirm or reject. If
 *                          neither happens before the timeout, the
 *                          request is abandoned and control stays
 *                          with the operator -- the safe default.
 *   AUTOMATIC           -- automation has control, operator confirmed it
 *   MANUAL_PENDING      -- automation is CEDING control back; the
 *                          operator must explicitly acknowledge
 *                          they're back in control. If nobody does
 *                          before the timeout, this is the genuinely
 *                          dangerous case (control reverted but
 *                          nobody confirmed they're watching) -- it
 *                          goes to FAILSAFE rather than silently
 *                          assuming the operator noticed.
 *   FAILSAFE            -- the system has already defaulted to
 *                          manual control, but requires an explicit
 *                          operator acknowledgment to clear the
 *                          alert before normal MANUAL operation
 *                          resumes. This state exists specifically
 *                          so a lapsed handoff is loud, not silent.
 *
 * Timeouts are driven by an explicit TICK event carrying the current
 * `now`, the same discipline as src/alarms/lifecycle.ts, rather than
 * XState's built-in `after` delays (which schedule a real timer
 * internally and make the machine non-deterministic to test). A
 * fresh actor fed a sequence of events, including TICKs with
 * increasing `now`, is exactly as replayable and property-testable
 * as calling the stage 1 reducer directly.
 */

import { createMachine } from "xstate";

export const AUTOMATION_HANDOFF_TIMEOUT_MS = 10_000;
export const MANUAL_HANDBACK_TIMEOUT_MS = 8_000;

export type HandoffState = "manual" | "automationPending" | "automatic" | "manualPending" | "failsafe";

export interface HandoffContext {
  // Not readonly: XState's inline action functions below mutate
  // these fields in place rather than using assign() -- the
  // established imperative style for XState v5 action functions,
  // and the same pattern as the mutable board Map in
  // src/alarms/lifecycle.ts's TICK handler.
  pendingSince: number | null;
  now: number;
}

export type HandoffEvent =
  | { type: "AUTOMATION_REQUEST"; now: number }
  | { type: "OPERATOR_CONFIRM" }
  | { type: "OPERATOR_REJECT" }
  | { type: "AUTOMATION_CEDE"; now: number }
  | { type: "MANUAL_OVERRIDE" }
  | { type: "OPERATOR_ACK" }
  | { type: "TICK"; now: number };

function pendingElapsed(context: HandoffContext, now: number): number {
  return context.pendingSince === null ? 0 : now - context.pendingSince;
}

export const handoffMachine = createMachine({
  id: "handoff",
  types: {} as {
    context: HandoffContext;
    events: HandoffEvent;
  },
  context: { pendingSince: null, now: 0 },
  initial: "manual",
  states: {
    manual: {
      on: {
        AUTOMATION_REQUEST: {
          target: "automationPending",
          actions: ({ context, event }) => {
            context.pendingSince = event.now;
            context.now = event.now;
          },
        },
        TICK: { actions: ({ context, event }) => { context.now = event.now; } },
      },
    },
    automationPending: {
      on: {
        OPERATOR_CONFIRM: { target: "automatic", actions: ({ context }) => { context.pendingSince = null; } },
        OPERATOR_REJECT: { target: "manual", actions: ({ context }) => { context.pendingSince = null; } },
        TICK: [
          {
            guard: ({ context, event }) => pendingElapsed(context, event.now) >= AUTOMATION_HANDOFF_TIMEOUT_MS,
            target: "manual",
            actions: ({ context, event }) => {
              context.now = event.now;
              context.pendingSince = null;
            },
          },
          { actions: ({ context, event }) => { context.now = event.now; } },
        ],
      },
    },
    automatic: {
      on: {
        // The core safety property: an operator override is always a
        // single, immediate transition -- never routed through a
        // pending/confirmation step the way a *new* automation
        // takeover is. Reclaiming control must never require
        // waiting on anything.
        MANUAL_OVERRIDE: "manual",
        AUTOMATION_CEDE: {
          target: "manualPending",
          actions: ({ context, event }) => {
            context.pendingSince = event.now;
            context.now = event.now;
          },
        },
        TICK: { actions: ({ context, event }) => { context.now = event.now; } },
      },
    },
    manualPending: {
      on: {
        OPERATOR_ACK: { target: "manual", actions: ({ context }) => { context.pendingSince = null; } },
        TICK: [
          {
            guard: ({ context, event }) => pendingElapsed(context, event.now) >= MANUAL_HANDBACK_TIMEOUT_MS,
            target: "failsafe",
            actions: ({ context, event }) => {
              context.now = event.now;
              context.pendingSince = null;
            },
          },
          { actions: ({ context, event }) => { context.now = event.now; } },
        ],
      },
    },
    failsafe: {
      on: {
        OPERATOR_ACK: "manual",
        TICK: { actions: ({ context, event }) => { context.now = event.now; } },
      },
    },
  },
});
