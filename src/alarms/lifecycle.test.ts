import { describe, expect, it } from "vitest";
import {
  createInitialAlarmState,
  DEFAULT_FLOOD_OPTIONS,
  isFlooding,
  reduceAlarm,
  type FloodOptions,
} from "./lifecycle";
import type { AlarmSystemState } from "./lifecycle";

function raise(state: AlarmSystemState, tag: string, now: number, priority: "critical" | "high" | "low" = "high") {
  return reduceAlarm(state, { type: "RAISE", tag, priority, description: `${tag} alarm`, now });
}

describe("basic lifecycle: raise, ack, clear", () => {
  it("a new raise creates an UNACK instance", () => {
    const state = raise(createInitialAlarmState(), "TT-1", 0);
    expect(state.board.get("TT-1")?.state).toBe("UNACK");
  });

  it("acknowledging an UNACK alarm moves it to ACKED", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "ACK", tag: "TT-1", now: 10 });
    expect(state.board.get("TT-1")?.state).toBe("ACKED");
    expect(state.board.get("TT-1")?.ackedAt).toBe(10);
  });

  it("clearing an ACKED alarm retires it to CLEARED", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "ACK", tag: "TT-1", now: 10 });
    state = reduceAlarm(state, { type: "CLEAR", tag: "TT-1", now: 20 });
    expect(state.board.get("TT-1")?.state).toBe("CLEARED");
  });

  it("clearing an UNACKED alarm does NOT silently remove it -- it needs RTN_UNACK", () => {
    // This is the exact mistake a naive "alerts panel" makes: treating
    // clear as delete. ISA-18.2 requires the operator still
    // acknowledge that an unacknowledged alarm occurred, even after
    // the condition is gone.
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "CLEAR", tag: "TT-1", now: 10 });
    expect(state.board.get("TT-1")?.state).toBe("RTN_UNACK");
    expect(state.board.has("TT-1")).toBe(true);
  });

  it("acknowledging an RTN_UNACK alarm finally retires it", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "CLEAR", tag: "TT-1", now: 10 });
    state = reduceAlarm(state, { type: "ACK", tag: "TT-1", now: 20 });
    expect(state.board.get("TT-1")?.state).toBe("CLEARED");
  });

  it("a duplicate raise while already active is a no-op", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    const after = raise(state, "TT-1", 50);
    expect(after.board.get("TT-1")?.raisedAt).toBe(0); // unchanged
  });

  it("a re-trip after RTN_UNACK reopens the alarm as a fresh UNACK", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "CLEAR", tag: "TT-1", now: 10 });
    state = raise(state, "TT-1", 20);
    expect(state.board.get("TT-1")?.state).toBe("UNACK");
    expect(state.board.get("TT-1")?.raisedAt).toBe(20);
  });
});

describe("shelving", () => {
  it("shelving an active alarm hides it with a reason and expiry", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, {
      type: "SHELVE",
      tag: "TT-1",
      reason: "known nuisance alarm, pending instrument recalibration",
      durationMs: 60_000,
      now: 100,
    });
    const inst = state.board.get("TT-1");
    expect(inst?.state).toBe("SHELVED");
    expect(inst?.shelf?.reason).toContain("recalibration");
    expect(inst?.shelf?.expiresAt).toBe(60_100);
  });

  it("the key ISA-18.2 invariant: a re-trip while shelved comes back into view immediately", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "SHELVE", tag: "TT-1", reason: "nuisance", durationMs: 60_000, now: 100 });
    expect(state.board.get("TT-1")?.state).toBe("SHELVED");

    // Far from expiry (shelf doesn't expire until 60100) -- still must surface.
    state = raise(state, "TT-1", 500);
    expect(state.board.get("TT-1")?.state).toBe("UNACK");
    expect(state.board.get("TT-1")?.shelf).toBeUndefined();
  });

  it("a shelf auto-expires via TICK back to the prior ack state", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "ACK", tag: "TT-1", now: 10 });
    state = reduceAlarm(state, { type: "SHELVE", tag: "TT-1", reason: "nuisance", durationMs: 1000, now: 100 });
    state = reduceAlarm(state, { type: "TICK", now: 500 }); // not yet expired
    expect(state.board.get("TT-1")?.state).toBe("SHELVED");
    state = reduceAlarm(state, { type: "TICK", now: 1200 }); // past expiresAt=1100
    expect(state.board.get("TT-1")?.state).toBe("ACKED"); // returns to its prior ACKED, not UNACK
  });

  it("a condition that clears while shelved resolves straight to CLEARED on expiry, not UNACK", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "SHELVE", tag: "TT-1", reason: "nuisance", durationMs: 1000, now: 100 });
    state = reduceAlarm(state, { type: "CLEAR", tag: "TT-1", now: 300 }); // clears while shelved
    expect(state.board.get("TT-1")?.state).toBe("SHELVED"); // shelf still stands
    state = reduceAlarm(state, { type: "TICK", now: 1200 }); // expiry
    expect(state.board.get("TT-1")?.state).toBe("CLEARED");
  });

  it("manual unshelve resolves the same way as expiry", () => {
    let state = raise(createInitialAlarmState(), "TT-1", 0);
    state = reduceAlarm(state, { type: "SHELVE", tag: "TT-1", reason: "nuisance", durationMs: 60_000, now: 100 });
    state = reduceAlarm(state, { type: "UNSHELVE", tag: "TT-1", now: 200 });
    expect(state.board.get("TT-1")?.state).toBe("UNACK");
  });
});

describe("flood suppression", () => {
  const options: FloodOptions = { windowMs: 1000, threshold: 3 };

  it("below the flood threshold, low-priority alarms surface normally", () => {
    let state = createInitialAlarmState();
    state = reduceAlarm(state, { type: "RAISE", tag: "L1", priority: "low", description: "d", now: 0 }, options);
    expect(state.board.get("L1")?.state).toBe("UNACK");
  });

  it("at/above the flood threshold, NEW low-priority alarms are suppressed", () => {
    let state = createInitialAlarmState();
    // Three raises inside the 1000ms window hits the threshold of 3.
    state = reduceAlarm(state, { type: "RAISE", tag: "L1", priority: "low", description: "d", now: 0 }, options);
    state = reduceAlarm(state, { type: "RAISE", tag: "L2", priority: "low", description: "d", now: 100 }, options);
    state = reduceAlarm(state, { type: "RAISE", tag: "L3", priority: "low", description: "d", now: 200 }, options);
    expect(isFlooding(state, 200, options)).toBe(true);
    state = reduceAlarm(state, { type: "RAISE", tag: "L4", priority: "low", description: "d", now: 250 }, options);
    expect(state.board.get("L4")?.state).toBe("SUPPRESSED");
  });

  it("the core safety invariant: high and critical alarms are NEVER suppressed, flood or not", () => {
    let state = createInitialAlarmState();
    for (let i = 0; i < 5; i++) {
      state = reduceAlarm(
        state,
        { type: "RAISE", tag: `L${i}`, priority: "low", description: "d", now: i * 10 },
        options,
      );
    }
    expect(isFlooding(state, 40, options)).toBe(true);
    state = reduceAlarm(
      state,
      { type: "RAISE", tag: "CRIT-1", priority: "critical", description: "d", now: 45 },
      options,
    );
    state = reduceAlarm(
      state,
      { type: "RAISE", tag: "HIGH-1", priority: "high", description: "d", now: 46 },
      options,
    );
    expect(state.board.get("CRIT-1")?.state).toBe("UNACK");
    expect(state.board.get("HIGH-1")?.state).toBe("UNACK");
  });

  it("a suppressed alarm can always be manually acknowledged into view", () => {
    let state = createInitialAlarmState();
    for (let i = 0; i < 3; i++) {
      state = reduceAlarm(
        state,
        { type: "RAISE", tag: `L${i}`, priority: "low", description: "d", now: i * 10 },
        options,
      );
    }
    state = reduceAlarm(
      state,
      { type: "RAISE", tag: "L-suppressed", priority: "low", description: "d", now: 25 },
      options,
    );
    expect(state.board.get("L-suppressed")?.state).toBe("SUPPRESSED");
    state = reduceAlarm(state, { type: "ACK", tag: "L-suppressed", now: 30 }, options);
    expect(state.board.get("L-suppressed")?.state).toBe("ACKED");
  });

  it("old raises fall out of the flood window over time", () => {
    let state = createInitialAlarmState();
    state = reduceAlarm(state, { type: "RAISE", tag: "L1", priority: "low", description: "d", now: 0 }, options);
    state = reduceAlarm(state, { type: "RAISE", tag: "L2", priority: "low", description: "d", now: 10 }, options);
    state = reduceAlarm(state, { type: "RAISE", tag: "L3", priority: "low", description: "d", now: 20 }, options);
    expect(isFlooding(state, 20, options)).toBe(true);
    // A TICK long after the window (1000ms) has passed should clear the flood.
    state = reduceAlarm(state, { type: "TICK", now: 5000 }, options);
    expect(isFlooding(state, 5000, options)).toBe(false);
  });
});

describe("default options", () => {
  it("DEFAULT_FLOOD_OPTIONS matches ISA-18.2 guidance: >10 alarms in 10 minutes", () => {
    expect(DEFAULT_FLOOD_OPTIONS.windowMs).toBe(10 * 60_000);
    expect(DEFAULT_FLOOD_OPTIONS.threshold).toBe(10);
  });
});
