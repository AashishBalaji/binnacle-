import { useCallback, useMemo, useState } from "react";
import { List } from "react-window";
import { useAlarmSystem } from "../alarms/useAlarmSystem";
import type { AlarmInstance, AlarmPriority } from "../alarms/types";
import { generateRecommendations, SUGGESTED_SHELVE_DURATION_MS } from "../recommendations/engine";
import { useRecommendationReview } from "../recommendations/useRecommendationReview";
import type { Recommendation } from "../recommendations/types";
import { AlarmRow, type AlarmRowProps } from "./AlarmRow";
import { FloodBanner } from "./FloodBanner";
import { RecommendationPanel } from "./RecommendationPanel";
import { ShelveForm } from "./ShelveForm";

const ROW_HEIGHT = 56;
const VISIBLE_STATES = new Set<AlarmInstance["state"]>(["UNACK", "ACKED", "RTN_UNACK", "SHELVED", "SUPPRESSED"]);

const PRIORITY_RANK: Record<AlarmPriority, number> = { critical: 0, high: 1, low: 2 };
// Unacknowledged states sort above acknowledged/shelved ones within
// the same priority, so the board reads worst-and-newest-first --
// the order an operator actually triages in.
const STATE_RANK: Record<AlarmInstance["state"], number> = {
  UNACK: 0,
  RTN_UNACK: 0,
  SUPPRESSED: 1,
  ACKED: 2,
  SHELVED: 3,
  CLEARED: 4,
};

function sortAlarms(alarms: readonly AlarmInstance[]): AlarmInstance[] {
  return [...alarms].sort((a, b) => {
    const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDelta !== 0) return priorityDelta;
    const stateDelta = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (stateDelta !== 0) return stateDelta;
    return b.raisedAt - a.raisedAt;
  });
}

export function AlarmConsole() {
  const { state, now, flooding, raise, clear, ack, shelve, unshelve } = useAlarmSystem();
  const [shelving, setShelving] = useState<string | null>(null);

  const alarms = useMemo(
    () => sortAlarms([...state.board.values()].filter((instance) => VISIBLE_STATES.has(instance.state))),
    [state.board],
  );

  const activeCount = useMemo(
    () => alarms.filter((a) => a.state === "UNACK" || a.state === "RTN_UNACK").length,
    [alarms],
  );

  const handleShelveRequest = useCallback((tag: string) => setShelving(tag), []);
  const handleShelveSubmit = useCallback(
    (reason: string, durationMs: number) => {
      if (shelving) shelve(shelving, reason, durationMs);
      setShelving(null);
    },
    [shelving, shelve],
  );

  // Stage 3: the recommendation engine is a pure function of the same
  // (board, now) this component already has -- no second, disconnected
  // copy of the alarm state. `isReviewed` filters out anything the
  // operator already acted on, so a decision isn't re-prompted every
  // render; a fresh excursion on the same tag (useRecommendationReview's
  // tag+raisedAt key) gets a fresh recommendation regardless.
  const { reviews, recordDecision, isReviewed } = useRecommendationReview();
  const recommendations = useMemo(
    () => generateRecommendations(state.board, now).filter((rec) => !isReviewed(rec.tag, rec.raisedAt)),
    [state.board, now, isReviewed],
  );

  const handleAcceptRecommendation = useCallback(
    (recommendation: Recommendation) => {
      switch (recommendation.action) {
        case "ACKNOWLEDGE":
          ack(recommendation.tag);
          break;
        case "SHELVE":
          shelve(
            recommendation.tag,
            "Recommended: low-priority, long past acknowledgment",
            recommendation.suggestedShelveDurationMs ?? SUGGESTED_SHELVE_DURATION_MS,
          );
          break;
        case "ESCALATE":
          // No real paging/ticketing system sits behind this project
          // (see README.md's scope section) -- accepting an escalation
          // acknowledges the alarm and records the decision below, the
          // same honesty-over-scope choice made everywhere else here.
          ack(recommendation.tag);
          break;
      }
      recordDecision(recommendation, "accepted", now);
    },
    [ack, shelve, recordDecision, now],
  );

  const handleRejectRecommendation = useCallback(
    (recommendation: Recommendation, note?: string) => recordDecision(recommendation, "rejected", now, note),
    [recordDecision, now],
  );

  // Exposed for the demo controls (App.tsx) and for tests -- a real
  // deployment would wire `raise`/`clear` to a live WebSocket feed
  // instead (see server/README, not yet built).
  const rowProps: AlarmRowProps = { alarms, now, onAck: ack, onClear: clear, onShelve: handleShelveRequest, onUnshelve: unshelve };

  return (
    <div className="alarm-console">
      <header className="alarm-console-header">
        <h1>Alarm Console</h1>
        <p aria-live="polite" className="alarm-summary">
          {activeCount} unacknowledged of {alarms.length} active alarm{alarms.length === 1 ? "" : "s"}
        </p>
      </header>

      <FloodBanner flooding={flooding} />

      {shelving ? (
        <ShelveForm tag={shelving} onSubmit={handleShelveSubmit} onCancel={() => setShelving(null)} />
      ) : null}

      <RecommendationPanel
        recommendations={recommendations}
        now={now}
        onAccept={handleAcceptRecommendation}
        onReject={handleRejectRecommendation}
      />

      {reviews.length > 0 ? (
        <section className="recommendation-log" aria-label="Recommendation review log">
          <h3>Review log</h3>
          <ul>
            {reviews.slice(0, 5).map((review, index) => (
              <li key={`${review.tag}-${review.reviewedAt}-${index}`}>
                <span className="recommendation-log-tag">{review.tag}</span> — {review.action.toLowerCase()}{" "}
                <span className={`recommendation-log-decision decision-${review.decision}`}>{review.decision}</span>
                {review.note ? `: ${review.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="alarm-list-header" aria-hidden="true">
        <span>Priority</span>
        <span>Tag</span>
        <span>Description</span>
        <span>State</span>
        <span>Elapsed</span>
        <span>Actions</span>
      </div>

      {alarms.length === 0 ? (
        <p className="alarm-empty">No active alarms.</p>
      ) : (
        <div className="alarm-list">
          {/* react-window's List already renders its own role="list"
              container with role="listitem" rows -- wrapping it in
              another role="list" div would put a non-listitem node
              between two list roles, which fails the
              aria-required-children check. aria-label goes straight
              onto List's own element instead. */}
          <List<AlarmRowProps>
            aria-label="Active alarms"
            rowComponent={AlarmRow}
            rowCount={alarms.length}
            rowHeight={ROW_HEIGHT}
            rowProps={rowProps}
            style={{ height: Math.min(alarms.length * ROW_HEIGHT, 480) }}
          />
        </div>
      )}

      <DemoControls onRaise={raise} />
    </div>
  );
}

/** Manual demo controls so a reviewer can trigger specific states
 * (including a flood) without waiting on the synthetic feed's random
 * timing. Clearly separate from the alarm board itself. */
function DemoControls({ onRaise }: { onRaise: (tag: string, priority: AlarmPriority, description: string) => void }) {
  const [counter, setCounter] = useState(0);

  const raiseOne = (priority: AlarmPriority) => {
    const tag = `DEMO-${priority.toUpperCase()}-${counter}`;
    setCounter((c) => c + 1);
    onRaise(tag, priority, `Manually raised ${priority} demo alarm`);
  };

  const raiseFlood = () => {
    for (let i = 0; i < 12; i++) {
      const tag = `FLOOD-${counter}-${i}`;
      onRaise(tag, "low", "Synthetic flood demo alarm");
    }
    setCounter((c) => c + 1);
  };

  return (
    <div className="demo-controls">
      <p className="demo-controls-label">Demo controls (synthetic, for review only):</p>
      <button type="button" onClick={() => raiseOne("critical")}>
        Raise critical
      </button>
      <button type="button" onClick={() => raiseOne("high")}>
        Raise high
      </button>
      <button type="button" onClick={() => raiseOne("low")}>
        Raise low
      </button>
      <button type="button" onClick={raiseFlood}>
        Simulate flood (12 low-priority alarms)
      </button>
    </div>
  );
}
