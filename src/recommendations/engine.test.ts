import { describe, expect, it } from "vitest";
import { generateRecommendations, SHELVE_CANDIDATE_AGE_MS, SUGGESTED_SHELVE_DURATION_MS, SUGGESTED_SHELVE_REASON } from "./engine";
import type { AlarmBoard, AlarmInstance } from "../alarms/types";

function boardOf(...instances: AlarmInstance[]): AlarmBoard {
  return new Map(instances.map((i) => [i.tag, i]));
}

function unack(tag: string, priority: AlarmInstance["priority"], raisedAt: number): AlarmInstance {
  return { tag, priority, state: "UNACK", raisedAt, description: `${tag} alarm` };
}

describe("generateRecommendations: UNACK alarms", () => {
  it("recommends ACKNOWLEDGE for a freshly-raised alarm", () => {
    const board = boardOf(unack("TT-1", "high", 0));
    const [rec] = generateRecommendations(board, 1_000);
    expect(rec.action).toBe("ACKNOWLEDGE");
    expect(rec.tag).toBe("TT-1");
  });

  it("recommends ESCALATE once a critical alarm passes its escalation age", () => {
    const board = boardOf(unack("TT-1", "critical", 0));
    const beforeThreshold = generateRecommendations(board, 2 * 60_000 - 1)[0];
    const atThreshold = generateRecommendations(board, 2 * 60_000)[0];
    expect(beforeThreshold.action).toBe("ACKNOWLEDGE");
    expect(atThreshold.action).toBe("ESCALATE");
  });

  it("recommends ESCALATE for a high-priority alarm past its (longer) threshold", () => {
    const board = boardOf(unack("TT-1", "high", 0));
    const rec = generateRecommendations(board, 5 * 60_000)[0];
    expect(rec.action).toBe("ESCALATE");
  });

  it("never recommends ESCALATE for a low-priority alarm, however old", () => {
    const board = boardOf(unack("TT-1", "low", 0));
    const rec = generateRecommendations(board, 10 * 60 * 60_000)[0]; // 10 hours
    expect(rec.action).toBe("ACKNOWLEDGE");
  });

  it("confidence rises with both priority and age", () => {
    const freshLow = generateRecommendations(boardOf(unack("A", "low", 0)), 1)[0];
    const freshCritical = generateRecommendations(boardOf(unack("B", "critical", 0)), 1)[0];
    expect(freshCritical.confidence).toBeGreaterThan(freshLow.confidence);

    const staleLow = generateRecommendations(boardOf(unack("A", "low", 0)), 5 * 60_000)[0];
    expect(staleLow.confidence).toBeGreaterThan(freshLow.confidence);
  });

  it("every recommendation carries at least one factor whose weights sum to its confidence", () => {
    const rec = generateRecommendations(boardOf(unack("TT-1", "high", 0)), 1_000)[0];
    expect(rec.factors.length).toBeGreaterThan(0);
    const sum = rec.factors.reduce((s, f) => s + f.weight, 0);
    expect(rec.confidence).toBeCloseTo(sum, 10);
  });
});

describe("generateRecommendations: RTN_UNACK alarms", () => {
  it("recommends ACKNOWLEDGE to close out a cleared-but-unacked excursion", () => {
    const inst: AlarmInstance = {
      tag: "TT-2",
      priority: "low",
      state: "RTN_UNACK",
      raisedAt: 0,
      clearedAt: 100,
      description: "x",
    };
    const rec = generateRecommendations(boardOf(inst), 5_000)[0];
    expect(rec.action).toBe("ACKNOWLEDGE");
    expect(rec.tag).toBe("TT-2");
  });
});

describe("generateRecommendations: ACKED alarms", () => {
  it("recommends nothing for a high-priority ACKED alarm, however old", () => {
    const inst: AlarmInstance = {
      tag: "TT-3",
      priority: "high",
      state: "ACKED",
      raisedAt: 0,
      ackedAt: 0,
      description: "x",
    };
    const recs = generateRecommendations(boardOf(inst), 10 * 60 * 60_000);
    expect(recs).toHaveLength(0);
  });

  it("recommends nothing for a low-priority ACKED alarm before the shelve-candidate age", () => {
    const inst: AlarmInstance = {
      tag: "TT-3",
      priority: "low",
      state: "ACKED",
      raisedAt: 0,
      ackedAt: 0,
      description: "x",
    };
    const recs = generateRecommendations(boardOf(inst), SHELVE_CANDIDATE_AGE_MS - 1);
    expect(recs).toHaveLength(0);
  });

  it("recommends SHELVE with a suggested duration once a low-priority ACKED alarm passes the candidate age", () => {
    const inst: AlarmInstance = {
      tag: "TT-3",
      priority: "low",
      state: "ACKED",
      raisedAt: 0,
      ackedAt: 0,
      description: "x",
    };
    const rec = generateRecommendations(boardOf(inst), SHELVE_CANDIDATE_AGE_MS)[0];
    expect(rec.action).toBe("SHELVE");
    expect(rec.suggestedShelveDurationMs).toBe(SUGGESTED_SHELVE_DURATION_MS);
    expect(rec.suggestedShelveReason).toBe(SUGGESTED_SHELVE_REASON);
  });
});

describe("generateRecommendations: states that need no review", () => {
  it.each(["SHELVED", "SUPPRESSED", "CLEARED"] as const)("produces no recommendation for %s", (state) => {
    const inst: AlarmInstance = { tag: "TT-9", priority: "low", state, raisedAt: 0, description: "x" };
    expect(generateRecommendations(boardOf(inst), 10 * 60 * 60_000)).toHaveLength(0);
  });
});

describe("generateRecommendations: ordering", () => {
  it("sorts worst-priority-first", () => {
    const board = boardOf(unack("LOW", "low", 0), unack("CRIT", "critical", 0), unack("HIGH", "high", 0));
    const recs = generateRecommendations(board, 1_000);
    expect(recs.map((r) => r.tag)).toEqual(["CRIT", "HIGH", "LOW"]);
  });

  it("returns an empty list for an empty board", () => {
    expect(generateRecommendations(new Map(), 0)).toEqual([]);
  });
});
