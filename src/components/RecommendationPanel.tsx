import { useId, useState } from "react";
import type { Recommendation } from "../recommendations/types";

export interface RecommendationPanelProps {
  readonly recommendations: readonly Recommendation[];
  readonly now: number;
  readonly onAccept: (recommendation: Recommendation) => void;
  readonly onReject: (recommendation: Recommendation, note?: string) => void;
}

const ACTION_LABEL: Record<Recommendation["action"], string> = {
  ACKNOWLEDGE: "Acknowledge",
  SHELVE: "Shelve",
  ESCALATE: "Escalate",
};

function formatAge(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Stage 3: a review queue for the (rule-based, see engine.ts)
 * recommendation engine's suggested actions. The design goal is
 * literally "explainable" -- every recommendation's `<details>`
 * disclosure shows the actual weighted factors the engine summed to
 * reach its confidence, not a restated score. Native `<details>`/
 * `<summary>` is used for that disclosure rather than a custom
 * expand/collapse widget, the same reasoning as ShelveForm's inline
 * (non-modal) form: it's keyboard- and screen-reader-operable with no
 * extra ARIA work. */
export function RecommendationPanel({ recommendations, now, onAccept, onReject }: RecommendationPanelProps) {
  return (
    <section className="recommendation-panel" aria-label="Recommended actions">
      <h2>Recommended actions</h2>
      {recommendations.length === 0 ? (
        <p className="recommendation-empty">No recommendations right now.</p>
      ) : (
        <ul className="recommendation-list">
          {recommendations.map((rec) => (
            <RecommendationItem
              key={`${rec.tag}@${rec.raisedAt}`}
              recommendation={rec}
              now={now}
              onAccept={onAccept}
              onReject={onReject}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface RecommendationItemProps {
  readonly recommendation: Recommendation;
  readonly now: number;
  readonly onAccept: (recommendation: Recommendation) => void;
  readonly onReject: (recommendation: Recommendation, note?: string) => void;
}

function RecommendationItem({ recommendation, now, onAccept, onReject }: RecommendationItemProps) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const noteId = useId();
  const confidencePct = Math.round(recommendation.confidence * 100);

  return (
    <li className={`recommendation-item priority-${recommendation.priority}`} data-testid="recommendation-item">
      <div className="recommendation-summary">
        <span className="recommendation-tag">{recommendation.tag}</span>
        <span className="recommendation-action">{ACTION_LABEL[recommendation.action]}</span>
        <span className="recommendation-confidence">
          <span className="recommendation-confidence-bar" aria-hidden="true">
            <span className="recommendation-confidence-fill" style={{ width: `${confidencePct}%` }} />
          </span>
          {confidencePct}% confidence
        </span>
      </div>

      <p className="recommendation-rationale">{recommendation.rationale}</p>

      <details className="recommendation-why">
        <summary>Why?</summary>
        <ul className="recommendation-factors">
          {recommendation.factors.map((factor) => (
            <li key={factor.label}>
              <span className="recommendation-factor-label">{factor.label}</span>
              <span className="recommendation-factor-weight">{Math.round(factor.weight * 100)}%</span>
              <span className="recommendation-factor-detail">{factor.detail}</span>
            </li>
          ))}
        </ul>
        <p className="recommendation-generated">
          Generated {formatAge(now - recommendation.generatedAt)} ago.
        </p>
      </details>

      <div className="recommendation-actions">
        <button type="button" onClick={() => onAccept(recommendation)} aria-label={`Accept recommendation for ${recommendation.tag}`}>
          Accept
        </button>
        {rejecting ? (
          <form
            className="recommendation-reject-form"
            aria-label={`Reject recommendation for ${recommendation.tag}`}
            onSubmit={(event) => {
              event.preventDefault();
              onReject(recommendation, note.trim() || undefined);
              setRejecting(false);
              setNote("");
            }}
          >
            <label htmlFor={noteId}>Reason for rejecting (optional)</label>
            <input id={noteId} type="text" value={note} onChange={(event) => setNote(event.target.value)} />
            <button type="submit">Confirm reject</button>
            <button type="button" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setRejecting(true)} aria-label={`Reject recommendation for ${recommendation.tag}`}>
            Reject
          </button>
        )}
      </div>
    </li>
  );
}
