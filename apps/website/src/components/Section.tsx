import type { ReactNode } from 'react';

/**
 * A page section with the standard header: a small eyebrow label, a serif
 * title and an optional lead paragraph. `tone="ink"` gives a dark band.
 */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  tone = 'paper',
  children,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  tone?: 'paper' | 'ink';
  children?: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} className={`section section--${tone}`} aria-labelledby={headingId}>
      <div className="container">
        <header className="section__header">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={headingId} className="section__title">
            {title}
          </h2>
          {lead && <p className="section__lead">{lead}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}
