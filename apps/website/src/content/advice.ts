import type { Source } from './sources.ts';

/**
 * What central banks tell households to do about payment outages.
 * `quote` is verbatim from the source; `text` paraphrases it closely.
 * Checked on 2026-11-04.
 */
export interface Advice {
  who: string;
  date: string;
  quote: string;
  text: string;
  source: Source;
}

export const ADVICE: Advice[] = [
  {
    who: 'De Nederlandsche Bank',
    date: '20 May 2025',
    quote: 'Prepare for a three-day disruption of electronic payments.',
    text: 'The Dutch central bank, with banks and consumer groups, advises keeping around €70 per adult and €30 per child in cash, for when payment terminals are not working, ATMs are down or online banking cannot be used.',
    source: {
      label: 'DNB',
      url: 'https://www.dnb.nl/en/general-news/press-release-2025/nfps-advice-prepare-for-a-three-day-disruption-of-electronic-payments/',
    },
  },
  {
    who: 'European Central Bank',
    date: 'Sept 2025',
    quote: 'A resilient, offline payment method.',
    text: 'That is how the ECB describes cash, after studying four crises from the pandemic to the Iberian blackout: “essential redundancy – a ‘spare tire’ – for the payment system”.',
    source: {
      label: 'ECB Economic Bulletin',
      url: 'https://www.ecb.europa.eu/press/economic-bulletin/articles/2025/html/ecb.ebart202506_02~1a773e2ca3.en.html',
    },
  },
  {
    who: 'Banco de España',
    date: 'Apr 2026',
    quote: 'We cannot guarantee that another blackout or similar situation will not occur.',
    text: 'A year after cards and mobile payments failed across Spain, its central bank suggests keeping a small cash reserve at home for essentials.',
    source: {
      label: 'The Local Spain',
      url: 'https://www.thelocal.es/20260513/how-much-money-spain-recommends-you-keep-at-home-for-emergencies',
    },
  },
];
