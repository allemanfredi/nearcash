import { useState } from 'react';
import { Section } from '../components/Section.tsx';
import { SourceLink } from '../components/SourceLink.tsx';
import { FIGURES } from '../content/figures.ts';
import { INCIDENTS, KIND_LABELS, type IncidentKind } from '../content/incidents.ts';

type Filter = IncidentKind | 'all';
const FILTERS: Filter[] = ['all', 'hacked', 'patched', 'outage', 'ordered'];

/**
 * The evidence: four sourced numbers for the scale of the problem
 * (content/figures.ts), then a filterable timeline of real, sourced
 * incidents (content/incidents.ts).
 */
export function Incidents() {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = INCIDENTS.filter((incident) => filter === 'all' || incident.kind === filter);
  const years = [...new Set(shown.map((incident) => incident.year))];

  return (
    <Section
      id="incidents"
      eyebrow="This is not hypothetical"
      title={
        <>
          The off switch, <em>flipped again and again.</em>
        </>
      }
      lead="Exchanges halted after hacks. Websites switched off to patch a flaw. Cloud regions, payment filters, power grids and whole countries going dark. In most of these cases the funds were safe in the end. For hours, days or months, people just couldn’t use them."
    >
      <dl className="figures" aria-label="The scale of the problem">
        {FIGURES.map((figure) => (
          <div key={figure.value} className="figure">
            <dt className="figure__value">{figure.value}</dt>
            <dd className="figure__label">{figure.label}</dd>
            <dd className="figure__source">
              <SourceLink source={figure.source} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="filters" role="group" aria-label="Filter incidents by cause">
        {FILTERS.map((option) => {
          const count = option === 'all' ? INCIDENTS.length : INCIDENTS.filter((i) => i.kind === option).length;
          return (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {option === 'all' ? 'All' : KIND_LABELS[option]}
              <span className="chip__count">{count}</span>
            </button>
          );
        })}
      </div>

      {years.map((year) => (
        <div key={year} className="timeline">
          <h3 className="timeline__year">{year}</h3>
          <ol className="timeline__list">
            {shown
              .filter((incident) => incident.year === year)
              .map((incident) => (
                <li key={incident.title} className="incident">
                  <div className="incident__meta">
                    <time>{incident.date}</time>
                    <span className={`tag tag--${incident.kind}`}>{KIND_LABELS[incident.kind]}</span>
                  </div>
                  <h4>{incident.title}</h4>
                  <p>{incident.text}</p>
                  <p className="incident__sources">
                    {incident.sources.map((source) => (
                      <SourceLink key={source.url} source={source} />
                    ))}
                  </p>
                </li>
              ))}
          </ol>
        </div>
      ))}
    </Section>
  );
}
