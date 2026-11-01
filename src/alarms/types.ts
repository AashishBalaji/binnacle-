/**
 * types.ts -- the vocabulary this whole module is built from.
 *
 * These states and transitions follow ISA-18.2 ("Management of Alarm
 * Systems for the Process Industries"), the real standard that
 * governs industrial alarm lifecycle -- not an invented simplification.
 * The states that most naive "alerts panel" implementations miss are
 * RTN_UNACK (the process condition has cleared, but an operator still
 * needs to acknowledge that it happened -- silently removing a cleared
 * alarm loses the record that it occurred at all) and the rule that a
 * shelved alarm must return to view if the condition re-trips, not
 * just when its shelf timer expires.
 */

export type AlarmPriority = "critical" | "high" | "low";

/**
 * The lifecycle states of ONE alarm instance (one tag's current
 * excursion). A tag can only be in one of these at a time; a new
 * excursion after CLEARED starts a fresh instance.
 *
 *   UNACK      -- condition is active, operator has not acknowledged it
 *   ACKED      -- condition is active, operator has acknowledged it
 *   RTN_UNACK  -- condition has returned to normal, but was never
 *                 acknowledged while active -- still needs operator
 *                 acknowledgment of the fact that it happened
 *   SHELVED    -- operator has temporarily suppressed this tag's
 *                 alarms, with a reason and an expiry; ends early if
 *                 the condition re-trips (see lifecycle.ts)
 *   SUPPRESSED -- system-level flood suppression: this LOW-priority
 *                 alarm was raised while the recent alarm rate was
 *                 too high for an operator to triage one at a time.
 *                 NEVER applied to high/critical alarms.
 *   CLEARED    -- condition is normal and the alarm has been
 *                 acknowledged (or never needed acknowledgment) --
 *                 terminal; the instance is retired.
 */
export type AlarmState =
  | "UNACK"
  | "ACKED"
  | "RTN_UNACK"
  | "SHELVED"
  | "SUPPRESSED"
  | "CLEARED";

export interface AlarmInstance {
  /** The alarm point's unique tag, e.g. "TT-204.HIGH" -- stands in for
   * an instrument tag + the condition that's alarming on it. */
  readonly tag: string;
  readonly priority: AlarmPriority;
  readonly state: AlarmState;
  /** When the current excursion started (the RAISE that created this
   * instance), monotonic ms. */
  readonly raisedAt: number;
  /** Set once the operator acknowledges, else undefined. */
  readonly ackedAt?: number;
  /** Set once the process condition returns to normal, else
   * undefined -- independent of acknowledgment. */
  readonly clearedAt?: number;
  /** Present only while SHELVED. */
  readonly shelf?: {
    readonly reason: string;
    readonly shelvedAt: number;
    readonly expiresAt: number;
  };
  /** A short, human-readable description -- what an operator would
   * actually see next to the tag ("High temperature"). */
  readonly description: string;
}

export type AlarmEvent =
  | { type: "RAISE"; tag: string; priority: AlarmPriority; description: string; now: number }
  | { type: "CLEAR"; tag: string; now: number }
  | { type: "ACK"; tag: string; now: number }
  | { type: "SHELVE"; tag: string; reason: string; durationMs: number; now: number }
  | { type: "UNSHELVE"; tag: string; now: number }
  /** A clock tick -- the only event that can expire a shelf or retire
   * a long-cleared instance; lets the reducer stay pure (no reads of
   * the real clock inside it) while still being time-driven. */
  | { type: "TICK"; now: number };

/** The whole board: one instance per currently-tracked tag. CLEARED
 * instances are dropped from this map once an UNSHELVE/ACK/TICK has
 * nothing left to do with them -- see lifecycle.ts's retireClearedAfterMs. */
export type AlarmBoard = ReadonlyMap<string, AlarmInstance>;
