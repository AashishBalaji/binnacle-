import { useCallback, useMemo, useState } from "react";
import { List } from "react-window";
import { useAlarmSystem } from "../alarms/useAlarmSystem";
import type { AlarmInstance, AlarmPriority } from "../alarms/types";
import { generateRecommendations } from "../recommendations/engine";
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
  // Set only when the open ShelveForm was opened by accepting a stage-3
  // SHELVE recommendation (as opposed to the manual row "Shelve"
  // button) -- see handleAcceptRecommendation and handleShelveSubmit
  // below. Pre-fills the form and is what actually records the
  // "accepted" decision, on submit, not on the initial click: clicking
  // Accept opens the form for confirmation, it doesn't commit anything
  // by itself, the same way the manual Shelve button never did either.
  const [pendingShelveRecommendation, setPendingShelveRecommendation] = useState<Recommendation | null>(null);

  const alarms = useMemo(
    () => sortAlarms([...state.board.values()].filter((instance) => VISIBLE_STATES.has(instance.state))),
    [state.board],
  );

  const activeCount = useMemo(
    () => alarms.filter((a) => a.state === "UNACK" || a.state === "RTN_UNACK").length,
    [alarms],
  );

  const handleShelveRequest = useCallback((tag: string) => {
    setPendingShelveRecommendation(null); // manual request, not a recommendation accept
    setShelving(tag);
  }, []);

  // Stage 3: the recommendation engine is a pure function of the same
  // (board, now) this component already has -- no second, disconnected
  // copy of the alarm state. `isReviewed` filters out anything the
  // operator already decided on; useRecommendationReview keys that by
  // tag + excursion + the specific action recommended, so a changed
  // recommendation on the same alarm (e.g. a rejected ACKNOWLEDGE
  // later becoming ESCALATE) is never silenced by the earlier decision.
  const { reviews, recordDecision, isReviewed } = useRecommendationReview();
  const recommendations = useMemo(
    () => generateRecommendations(state.board, now).filter((rec) => !isReviewed(rec)),
    [state.board, now, isReviewed],
  );

  const handleShelveSubmit = useCallback(
    (reason: string, durationMs: number) => {
      if (shelving) shelve(shelving, reason, durationMs);
      // Only a SHELVE recommendation's form actually records a
      // decision -- submitting is the confirmation step, not the
      // earlier Accept click.
      if (pendingShelveRecommendation) recordDecision(pendingShelveRecommendation, "accepted", now);
      setShelving(null);
      setPendingShelveRecommendation(null);
    },
    [shelving, shelve, pendingShelveRecommendation, recordDecision, now],
  );

  const handleCancelShelve = useCallback(() => {
    // Cancelling records nothing: the recommendation (if any) stays
    // exactly as un-reviewed as it was before Accept was clicked, so
    // it's still there to act on later.
    setShelving(null);
    setPendingShelveRecommendation(null);
  }, []);

  const handleAcceptRecommendation = useCallback(
    (recommendation: Recommendation) => {
      switch (recommendation.action) {
        case "ACKNOWLEDGE":
          ack(recommendation.tag);
          recordDecision(recommendation, "accepted", now);
          break;
        case "SHELVE":
          // Shelving is the highest-stakes accepted action available
          // here (it suppresses an alarm), so -- unlike ACKNOWLEDGE and
          // ESCALATE above/below -- accepting it opens the real
          // ShelveForm, pre-filled with the engine's suggestion, for
          // the operator to confirm or edit, rather than silently
          // applying a fixed reason/duration on one click. The
          // decision is recorded on submit (handleShelveSubmit), not
          // here.
          setPendingShelveRecommendation(recommendation);
          setShelving(recommendation.tag);
          break;
        case "ESCALATE":
          // No real paging/ticketing system sits behind this project
          // (see README.md's scope section) -- accepting an escalation
          // acknowledges the alarm and records the decision below, the
          // same honesty-over-scope choice made everywhere else here.
          ack(recommendation.tag);
          recordDecision(recommendation, "accepted", now);
          break;
      }
    },
    [ack, recordDecision, now],
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
        <ShelveForm
          tag={shelving}
          onSubmit={handleShelveSubmit}
          onCancel={handleCancelShelve}
          initialReason={pendingShelveRecommendation?.suggestedShelveReason}
          initialDurationMs={pendingShelveRecommendation?.suggestedShelveDurationMs}
        />
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
