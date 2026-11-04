import type { Source } from '../content/sources.ts';
import { Icon } from './Icon.tsx';

/** An external link to the source behind a claim. Opens in a new tab. */
export function SourceLink({ source }: { source: Source }) {
  return (
    <a className="source-link" href={source.url} target="_blank" rel="noreferrer noopener">
      {source.label}
      <Icon name="arrowUpRight" size={14} />
    </a>
  );
}
