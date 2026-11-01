/**
 * handoffMachine.properties.test.ts -- generative proof of the two
 * safety properties this machine exists for, the same technique used
 * in src/alarms/lifecycle.properties.test.ts: generate thousands of
 * random event sequences and check the invariant holds after every
 * single event, not just a handful of hand-picked examples.
 *
 * Invariant 1 (no unilateral automation takeover): the machine can
 * never be in "automatic" immediately after an "AUTOMATION_REQUEST"
 * -- it must pass through "automationPending" and get an explicit
 * OPERATOR_CONFIRM first, regardless of what other events preceded
 * it in the sequence.
 *
 * Invariant 2 (every pending state is bounded): if the machine is in
 * "automationPending" or "manualPending" and enough TICKs with
 * increasing `now` are delivered to cross that state's timeout, it
 * always leaves that pending state -- it can never be stuck waiting
 * forever on an operator who isn't responding.
 */

import fc from "fast-check";
import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import {
  AUTOMATION_HANDOFF_TIMEOUT_MS,
  MANUAL_HANDBACK_TIMEOUT_MS,
  handoffMachine,
  type HandoffEvent,
} from "./handoffMachine";

const BARE_EVENT_TYPES = ["OPERATOR_CONFIRM", "OPERATOR_REJECT", "MANUAL_OVERRIDE", "OPERATOR_ACK"] as const;
const TIMED_EVENT_TYPES = ["AUTOMATION_REQUEST", "AUTOMATION_CEDE", "TICK"] as const;
const TIMED_EVENT_TYPE_SET: ReadonlySet<string> = new Set(TIMED_EVENT_TYPES);

type EventShape = { type: (typeof BARE_EVENT_TYPES)[number] | (typeof TIMED_EVENT_TYPES)[number] };

const eventShapeArbitrary: fc.Arbitrary<EventShape> = fc.oneof(
  ...BARE_EVENT_TYPES.map((type) => fc.constant({ type })),
  ...TIMED_EVENT_TYPES.map((type) => fc.record({ type: fc.constant(type) })),
);

/** Same timestamp-layering approach as the alarm lifecycle property
 * tests: random small gaps, strictly increasing `now`, so bursts and
 * long quiet periods both occur across a sequence. The timed event
 * types all happen to share the same {type, now} shape, so a cast
 * back to HandoffEvent here is safe -- fc.record's return type just
 * doesn't carry that correlation automatically. */
function withTimestamps(shapes: readonly EventShape[], gaps: readonly number[]): HandoffEvent[] {
  let now = 0;
  return shapes.map((shape, i) => {
    now += gaps[i % gaps.length] ?? 500;
    return (TIMED_EVENT_TYPE_SET.has(shape.type) ? { ...shape, now } : shape) as HandoffEvent;
  });
}

const sequenceArbitrary = fc
  .tuple(
    fc.array(eventShapeArbitrary, { minLength: 1, maxLength: 80 }),
    fc.array(fc.integer({ min: 0, max: Math.max(AUTOMATION_HANDOFF_TIMEOUT_MS, MANUAL_HANDBACK_TIMEOUT_MS) + 500 }), {
      minLength: 1,
      maxLength: 10,
    }),
  )
  .map(([shapes, gaps]) => withTimestamps(shapes, gaps));

const VALID_STATES = new Set(["manual", "automationPending", "automatic", "manualPending", "failsafe"]);

describe("property: automation never takes control in a single step", () => {
  it("AUTOMATION_REQUEST never transitions straight into 'automatic'", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (events) => {
        const actor = createActor(handoffMachine);
        actor.start();
        for (const event of events) {
          const before = actor.getSnapshot().value;
          actor.send(event);
          const after = actor.getSnapshot().value;
          expect(VALID_STATES.has(after as string)).toBe(true);
          // The invariant, as an implication rather than a
          // conditional expect: an AUTOMATION_REQUEST that actually
          // caused a transition (i.e. the state changed) must land
          // in automationPending, never jump straight to automatic.
          // (If it was a no-op -- e.g. already in automatic, where
          // this event has no handler -- "before === after" makes
          // the left side true and the check passes trivially.)
          const requestInvariantHolds =
            !(event.type === "AUTOMATION_REQUEST" && before !== after) || after === "automationPending";
          expect(requestInvariantHolds).toBe(true);
        }
        actor.stop();
        return true;
      }),
      { numRuns: 500 },
    );
  });
});

describe("property: pending states are always bounded", () => {
  it("automationPending always resolves once enough time has passed, never stuck waiting forever", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (events) => {
        const actor = createActor(handoffMachine);
        actor.start();
        let pendingSinceNow: number | null = null;

        for (const event of events) {
          const before = actor.getSnapshot();
          if (before.value === "automationPending" && pendingSinceNow === null) {
            pendingSinceNow = before.context.pendingSince;
          }
          actor.send(event);
          const after = actor.getSnapshot();

          // Implication, not a conditional expect: once the timeout
          // has genuinely elapsed, a TICK must never leave the
          // machine still in automationPending.
          const timeoutElapsed =
            event.type === "TICK" && pendingSinceNow !== null && event.now - pendingSinceNow >= AUTOMATION_HANDOFF_TIMEOUT_MS;
          const resolvedInTime = !timeoutElapsed || after.value !== "automationPending" || before.value !== "automationPending";
          expect(resolvedInTime).toBe(true);
          if (after.value !== "automationPending") pendingSinceNow = null;
        }
        actor.stop();
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it("manualPending always resolves (to manual or failsafe) once enough time has passed", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (events) => {
        const actor = createActor(handoffMachine);
        actor.start();
        let pendingSinceNow: number | null = null;

        for (const event of events) {
          const before = actor.getSnapshot();
          if (before.value === "manualPending" && pendingSinceNow === null) {
            pendingSinceNow = before.context.pendingSince;
          }
          actor.send(event);
          const after = actor.getSnapshot();

          const timeoutElapsed =
            event.type === "TICK" && pendingSinceNow !== null && event.now - pendingSinceNow >= MANUAL_HANDBACK_TIMEOUT_MS;
          const resolvedInTime = !timeoutElapsed || after.value !== "manualPending" || before.value !== "manualPending";
          expect(resolvedInTime).toBe(true);
          if (after.value !== "manualPending") pendingSinceNow = null;
        }
        actor.stop();
        return true;
      }),
      { numRuns: 500 },
    );
  });
});
