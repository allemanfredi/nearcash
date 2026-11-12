import type { ReactNode } from 'react';

/**
 * One kiosk screen: the brand bar (with optional Back / Cancel), a title,
 * the content, and the main actions pinned to the bottom where a thumb is.
 */
export function Screen({
  title,
  lead,
  step,
  onBack,
  onCancel,
  actions,
  children,
}: {
  title: ReactNode;
  lead?: ReactNode;
  /** "2 of 4" progress, for the steps before paying. */
  step?: { current: number; total: number };
  onBack?: () => void;
  onCancel?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="screen">
      <header className="bar">
        {onBack ? (
          <button type="button" className="bar__button" onClick={onBack}>
            ← Back
          </button>
        ) : (
          <span className="brand">
            <img className="brand__mark" src="./icon.svg" alt="" width={22} height={22} />
            NearCash
          </span>
        )}
        {step && (
          <span className="bar__step" aria-label={`Step ${step.current} of ${step.total}`}>
            {Array.from({ length: step.total }, (_, index) => (
              <span key={index} className={`bar__dot ${index < step.current ? 'is-done' : ''}`} />
            ))}
          </span>
        )}
        {onCancel ? (
          <button type="button" className="bar__button" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <span className="bar__spacer" />
        )}
      </header>

      <main className="screen__body">
        <h1 className="screen__title">{title}</h1>
        {lead && <p className="screen__lead">{lead}</p>}
        {children}
      </main>

      {actions && <footer className="screen__actions">{actions}</footer>}
    </div>
  );
}
