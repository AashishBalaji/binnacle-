import { useId, useState } from "react";

export interface ShelveFormProps {
  readonly tag: string;
  readonly onSubmit: (reason: string, durationMs: number) => void;
  readonly onCancel: () => void;
}

const DURATION_OPTIONS = [
  { label: "15 minutes", ms: 15 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "4 hours", ms: 4 * 60 * 60_000 },
  { label: "Until end of shift (8 hours)", ms: 8 * 60 * 60_000 },
] as const;

/** An inline form rather than a modal dialog: it stays in normal tab
 * order, needs no focus trap, and a screen reader announces it as
 * ordinary page content the moment it appears -- simpler to get
 * right than a dialog, and shelving is a deliberate, low-frequency
 * action where that trade-off is the right one. */
export function ShelveForm({ tag, onSubmit, onCancel }: ShelveFormProps) {
  const [reason, setReason] = useState("");
  const [durationMs, setDurationMs] = useState<number>(DURATION_OPTIONS[0].ms);
  const reasonId = useId();
  const durationId = useId();

  return (
    <form
      className="shelve-form"
      aria-label={`Shelve ${tag}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!reason.trim()) return;
        onSubmit(reason.trim(), durationMs);
      }}
    >
      <label htmlFor={reasonId}>Reason for shelving {tag}</label>
      <input
        id={reasonId}
        type="text"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
      />
      <label htmlFor={durationId}>Shelve duration</label>
      <select id={durationId} value={durationMs} onChange={(event) => setDurationMs(Number(event.target.value))}>
        {DURATION_OPTIONS.map((option) => (
          <option key={option.ms} value={option.ms}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="shelve-form-actions">
        <button type="submit">Confirm shelve</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
