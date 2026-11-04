import type { Source } from './sources.ts';

/**
 * The scale of the problem, in four sourced numbers (shown above the
 * incident timeline). Checked on 2026-11-04: before editing, re-read the
 * source and keep the label as narrow as the source is.
 */
export interface Figure {
  value: string;
  label: string;
  source: Source;
}

export const FIGURES: Figure[] = [
  {
    value: '313',
    label: 'internet shutdowns in 52 countries in 2025, up from 304 in 2024',
    source: {
      label: 'Access Now',
      url: 'https://www.accessnow.org/press-release/rising-and-resisting-in-the-darkness-internet-shutdowns-in-2025/',
    },
  },
  {
    value: '$19.7B',
    label: 'lost to government internet shutdowns in 2025, 156% more than in 2024',
    source: { label: 'Top10VPN', url: 'https://www.top10vpn.com/research/cost-of-internet-shutdowns/' },
  },
  {
    value: '$3.4B',
    label: 'stolen in crypto hacks in 2025, from January to early December',
    source: { label: 'Chainalysis, via The Block', url: 'https://www.theblock.co/post/382477/crypto-hack-2025-chainalysis' },
  },
  {
    value: '88 days',
    label: 'without internet in Iran in 2026: the longest nationwide shutdown in modern history',
    source: { label: 'NetBlocks, via heise', url: 'https://heise.de/-11307773' },
  },
];
