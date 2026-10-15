import type { MoveAssessment } from "../lib/coaching";

export function RetryActions({ assessment, laterPlies, disabled, onContinue, onTryAnother, onShowLine }: {
  assessment: MoveAssessment; laterPlies: number; disabled: boolean;
  onContinue: () => void; onTryAnother: () => void; onShowLine: () => void;
}) {
  return <section className="retry-continuation" aria-label="Use this candidate">
    <p>Continue with <strong>{assessment.playedSan}</strong>{laterPlies > 0 ? ` and replace the ${laterPlies} later ${laterPlies === 1 ? "move" : "moves"}` : " in place of your original move"}. Your original line stays available to restore.</p>
    <div className="coached-actions">
      <button className="primary-action" disabled={disabled} onClick={onContinue}>Continue from this move<span>→</span></button>
      <button className="text-button" disabled={disabled} onClick={onTryAnother}>Try another move</button>
      <button className="secondary-action" disabled={disabled} onClick={onShowLine}>Show candidate line</button>
    </div>
  </section>;
}
