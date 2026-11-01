import type { RowComponentProps } from "react-window";
import type { AlarmInstance } from "../alarms/types";

export interface AlarmRowActions {
  readonly onAck: (tag: string) => void;
  readonly onClear: (tag: string) => void;
  readonly onShelve: (tag: string) => void;
  readonly onUnshelve: (tag: string) => void;
}

export interface AlarmRowProps extends AlarmRowActions {
  readonly alarms: readonly AlarmInstance[];
  /** Caller-supplied clock reading (ms since page load), same `now`
   * the reducer uses -- so elapsed time is consistent with the rest
   * of the system and this component stays a pure function of props. */
  readonly now: number;
}

const PRIORITY_LABEL: Record<AlarmInstance["priority"], string> = {
  critical: "Critical",
  high: "High",
  low: "Low",
};

const STATE_LABEL: Record<AlarmInstance["state"], string> = {
  UNACK: "Unacknowledged",
  ACKED: "Acknowledged",
  RTN_UNACK: "Returned to normal – unacknowledged",
  SHELVED: "Shelved",
  SUPPRESSED: "Suppressed (flood)",
  CLEARED: "Cleared",
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** One row of the virtualized alarm list. Rendered by react-window's
 * `List`, so it must stay a plain, fast function of (index, style,
 * rowProps) -- the list may mount/unmount this component as the
 * operator scrolls, so no local state lives here. */
export function AlarmRow({
  ariaAttributes,
  index,
  style,
  alarms,
  now,
  onAck,
  onClear,
  onShelve,
  onUnshelve,
}: RowComponentProps<AlarmRowProps>) {
  const alarm = alarms[index];
  if (!alarm) return null;

  const canAck = alarm.state === "UNACK" || alarm.state === "RTN_UNACK" || alarm.state === "SUPPRESSED";
  const canClear = alarm.state === "UNACK" || alarm.state === "ACKED";
  const canShelve = alarm.state === "UNACK" || alarm.state === "ACKED" || alarm.state === "SUPPRESSED";
  const canUnshelve = alarm.state === "SHELVED";

  return (
    <div
      {...ariaAttributes}
      style={style}
      className={`alarm-row priority-${alarm.priority} state-${alarm.state.toLowerCase()}`}
      data-testid="alarm-row"
    >
      <span className="alarm-priority" aria-hidden="true">
        {PRIORITY_LABEL[alarm.priority]}
      </span>
      <span className="alarm-tag">{alarm.tag}</span>
      <span className="alarm-description">{alarm.description}</span>
      <span className="alarm-state">
        {STATE_LABEL[alarm.state]}
        {alarm.state === "SHELVED" && alarm.shelf ? ` – ${alarm.shelf.reason}` : null}
      </span>
      <span className="alarm-elapsed">{formatElapsed(now - alarm.raisedAt)}</span>
      <span className="alarm-actions">
        <button type="button" disabled={!canAck} onClick={() => onAck(alarm.tag)} aria-label={`Acknowledge ${alarm.tag}`}>
          Ack
        </button>
        <button type="button" disabled={!canClear} onClick={() => onClear(alarm.tag)} aria-label={`Clear ${alarm.tag}`}>
          Clear
        </button>
        {canUnshelve ? (
          <button type="button" onClick={() => onUnshelve(alarm.tag)} aria-label={`Unshelve ${alarm.tag}`}>
            Unshelve
          </button>
        ) : (
          <button type="button" disabled={!canShelve} onClick={() => onShelve(alarm.tag)} aria-label={`Shelve ${alarm.tag}`}>
            Shelve
          </button>
        )}
      </span>
    </div>
  );
}
