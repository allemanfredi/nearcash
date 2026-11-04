import { Section } from '../components/Section.tsx';
import { SourceLink } from '../components/SourceLink.tsx';
import { ADVICE } from '../content/advice.ts';

/**
 * Central banks now tell households to keep cash for payment outages
 * (content/advice.ts). Crypto has no such fallback: NearCash is one.
 */
export function Advice() {
  return (
    <Section
      id="advice"
      eyebrow="What central banks advise"
      title={
        <>
          Central banks already say it: <em>keep some cash at home.</em>
        </>
      }
      lead="After the Iberian blackout, Europe’s central banks began saying out loud what every outage shows: electronic payments can stop, and a few days of cash is the backup."
    >
      <div className="advice">
        {ADVICE.map((item) => (
          <figure key={item.who} className="advice__item">
            <figcaption className="advice__meta">
              <span className="advice__who">{item.who}</span>
              <span className="advice__date">{item.date}</span>
            </figcaption>
            <blockquote className="advice__quote">
              <p>“{item.quote}”</p>
            </blockquote>
            <p className="advice__text">{item.text}</p>
            <p className="advice__source">
              <SourceLink source={item.source} />
            </p>
          </figure>
        ))}
      </div>

      <p className="callout">
        Their advice is about euros. Crypto never had an equivalent: something you keep in a drawer and
        hand over with no network at all. <strong>A NearCash banknote is exactly that.</strong>
      </p>
    </Section>
  );
}
