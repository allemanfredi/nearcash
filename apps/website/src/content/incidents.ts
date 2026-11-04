import type { Source } from './sources.ts';

/**
 * Real incidents in which servers, networks or providers went away and
 * people lost access to services or to their money. Newest first.
 *
 * Every entry is sourced; the wording sticks to what the sources say
 * (checked on 2026-11-03 and 2026-11-04). Before editing, re-read the
 * source: most of these outages ended with "funds are safe", so the claim
 * we make is about losing access to money, not losing the money.
 */

export type IncidentKind = 'hacked' | 'patched' | 'outage' | 'ordered';

export interface Incident {
  /** Human-readable date or range. */
  date: string;
  /** Used for grouping on the page. */
  year: number;
  kind: IncidentKind;
  title: string;
  text: string;
  sources: Source[];
}

export const KIND_LABELS: Record<IncidentKind, string> = {
  hacked: 'Hacked',
  patched: 'Patched in a panic',
  outage: 'Infrastructure failure',
  ordered: 'Switched off',
};

export const INCIDENTS: Incident[] = [
  // ------------------------------------------------------------------ 2026
  {
    date: '2 Nov 2026',
    year: 2026,
    kind: 'hacked',
    title: 'Mercado Bitcoin suspends deposits and withdrawals',
    text: 'After a security incident, Brazil’s Mercado Bitcoin stopped deposits and withdrawals “as a precaution” and gave no date for their return. A security firm estimates more than $40 million moved out of wallets linked to the exchange.',
    sources: [{ label: 'The Rio Times', url: 'https://www.riotimesonline.com/brazil-mercado-bitcoin-halts-withdrawals-security-incident-2026' }],
  },
  {
    date: '29 Oct – 1 Nov 2026',
    year: 2026,
    kind: 'hacked',
    title: 'Binance halts withdrawals after a $6.3 billion theft',
    text: 'The world’s largest exchange suspended user withdrawals after an attack it put at $6.3 billion, attributed by the FBI to North Korea. Withdrawals came back in phases, Bitcoin first, from 1 November.',
    sources: [{ label: 'France 24', url: 'https://www.france24.com/en/business/20261101-binance-says-resuming-withdrawals-after-major-hack' }],
  },
  {
    date: '30–31 Oct 2026',
    year: 2026,
    kind: 'hacked',
    title: 'A dozen DeFi websites hijacked at their registrar',
    text: 'Front ends registered with Name.com were redirected to a wallet drainer and then suspended. The smart contracts were never touched. The websites in front of them were.',
    sources: [{ label: 'The Block', url: 'https://www.theblock.co/news/defi/2026-10-31-hackers-hijack-a-dozen-defi-websites-all-registered-with-name-com-and-steal-about-138000-432251' }],
  },
  {
    date: '21–23 Oct 2026',
    year: 2026,
    kind: 'patched',
    title: 'A PHP flaw switches off government and bank websites',
    text: 'Two critical PHP flaws allowed remote code execution, with “no complete mitigations”. Operators took services offline while they patched: more than 30 UK government services stayed down, and Japanese banks and brokers including MUFG and Nomura suspended some internet services.',
    sources: [
      { label: 'The National', url: 'https://www.thenationalnews.com/news/europe/2026/10/22/uk-orders-dozens-of-official-websites-offline-after-flaw-warnings' },
      { label: 'php.net advisory', url: 'https://www.php.net/archive/2026.php' },
    ],
  },
  {
    date: '19–20 Oct 2026',
    year: 2026,
    kind: 'outage',
    title: 'A power failure in one cloud region stops UK banking apps',
    text: 'A “power event” in Google Cloud’s London region caused errors across the services running there. Revolut card payments, transfers, cash withdrawals and sign-ins were down or partly unavailable, and Lloyds, Halifax and HSBC customers reported problems. Revolut said its customers’ money was safe. For hours, some of them couldn’t use it.',
    sources: [
      { label: 'The Irish News (PA)', url: 'https://www.irishnews.com/news/uk/banks-and-courts-affected-by-disruption-as-google-apologises-for-cloud-outage-NGVJFIJO7NK47DX5KKSFPTUGNQ/' },
    ],
  },
  {
    date: '7–8 May 2026',
    year: 2026,
    kind: 'outage',
    title: 'An overheating data centre stops trading on Coinbase',
    text: 'Overheating at an AWS data centre in Northern Virginia cut power to hardware. Coinbase put all its markets in “cancel only” mode, and some customers couldn’t trade on the web or in the app.',
    sources: [{ label: 'Cointelegraph', url: 'https://cointelegraph.com/news/aws-data-center-overheating-impacting-coinbase-others' }],
  },
  {
    date: '6 Apr 2026',
    year: 2026,
    kind: 'outage',
    title: 'A wallet app can’t load prices, and users can’t sell',
    text: 'Phantom’s app told users: “We are having trouble updating your token prices. Your funds are safe.” For over an hour the outage hit prices and balances in the app, and some users reported they couldn’t sell. The coins never left the chain.',
    sources: [{ label: 'The Block', url: 'https://www.theblock.co/post/396479/phantom-reports-service-outage' }],
  },
  {
    date: 'Jan – May 2026',
    year: 2026,
    kind: 'ordered',
    title: 'Iran cuts its internet off for months',
    text: 'A weeks-long blackout during the January protests, then another from 28 February, when the war began: 88 days that NetBlocks called the longest nationwide internet shutdown in modern history. Only a state-filtered intranet kept services such as banking running. Iran’s Chamber of Commerce put the direct cost at $30–40 million a day.',
    sources: [
      { label: 'Al-Monitor', url: 'https://www.al-monitor.com/originals/2026/01/irans-internet-blackout-enters-third-week-filtered-access-flickers-back' },
      { label: 'The National', url: 'https://thenationalnews.com/news/mena/2026/05/27/internet-restored-to-tens-of-millions-in-iran-after-three-month-blackout' },
      { label: 'heise', url: 'https://heise.de/-11307773' },
    ],
  },

  // ------------------------------------------------------------------ 2025
  {
    date: '5 Dec 2025',
    year: 2025,
    kind: 'patched',
    title: 'An emergency fix takes Cloudflare down',
    text: 'While rushing out protection against the React2Shell flaw, Cloudflare broke its own network: for 25 minutes, about 28% of the HTTP traffic it serves failed.',
    sources: [{ label: 'Cloudflare', url: 'https://blog.cloudflare.com/5-december-2025-outage/' }],
  },
  {
    date: '27 Nov 2025',
    year: 2025,
    kind: 'hacked',
    title: 'South Korea’s largest exchange halts deposits and withdrawals',
    text: 'About $37 million in Solana tokens left an Upbit hot wallet. The exchange halted deposits and withdrawals and said it would cover the losses from its own reserves.',
    sources: [{ label: 'The Block', url: 'https://www.theblock.co/news/business/2025-11-26-upbit-suffers-37-million-hack-380664' }],
  },
  {
    date: '18 Nov 2025',
    year: 2025,
    kind: 'outage',
    title: 'One bad file breaks a large part of the web',
    text: 'A faulty configuration file took down Cloudflare for hours, Cloudflare calling it its worst outage since 2019. Crypto exchanges, block explorers and the swap services inside wallets went down with it.',
    sources: [
      { label: 'Cloudflare', url: 'https://blog.cloudflare.com/18-november-2025-outage/' },
      { label: 'Ledger status', url: 'https://status.ledger.com/incidents/bvjd0fw4nbwv' },
    ],
  },
  {
    date: '19–20 Oct 2025',
    year: 2025,
    kind: 'outage',
    title: 'AWS us-east-1 goes dark, and wallets show zero',
    text: 'A DNS fault in one AWS region lasted about 15 hours. Coinbase customers couldn’t buy, sell or log in. MetaMask showed some users zero balances as the providers behind it failed. Not a coin had moved: the path to them had.',
    sources: [
      { label: 'AWS', url: 'https://aws.amazon.com/message/101925/' },
      { label: 'Coinbase status', url: 'https://status.commerce.coinbase.com/incidents/zmr4w5wymh0n' },
      { label: 'Decrypt', url: 'https://decrypt.co/345036/metamask-showing-zero-balances-base-network-struggling-aws-issues-persist' },
    ],
  },
  {
    date: '29 Sep – 1 Oct 2025',
    year: 2025,
    kind: 'ordered',
    title: 'Afghanistan switches off its internet and phones',
    text: 'The Taliban authorities shut down telecommunications across the country. For 48 hours connectivity fell to 1% of normal levels, NetBlocks said, and banks and post offices were unable to operate.',
    sources: [{ label: 'Dawn (AFP)', url: 'https://www.dawn.com/news/1945870' }],
  },
  {
    date: '25–26 Aug 2025',
    year: 2025,
    kind: 'outage',
    title: 'PayPal’s fraud filters fail, and German banks stop its payments',
    text: 'PayPal’s systems for catching fraudulent direct debits failed, so debits reached banks unchecked. To contain the damage, banks blocked PayPal direct debits worth billions of euros, and payments were held up for hours.',
    sources: [{ label: 'The Local Germany', url: 'https://www.thelocal.de/20250827/paypal-direct-debit-glitch-causes-major-payment-delays-in-germany' }],
  },
  {
    date: '18 Jun 2025',
    year: 2025,
    kind: 'hacked',
    title: 'A hack takes Iran’s largest crypto exchange offline',
    text: 'Hacktivists claimed an attack on Nobitex’s hot wallets worth tens of millions of dollars. The exchange took its website and app offline while it investigated, and said most user assets were safe in cold storage.',
    sources: [{ label: 'Iran International', url: 'https://www.iranintl.com/en/202506188003' }],
  },
  {
    date: '28 Apr 2025',
    year: 2025,
    kind: 'outage',
    title: 'A blackout across Spain and Portugal',
    text: 'With the power down, card payments in Spain fell 55% and Bizum mobile payments 75%. Most ATMs had no backup power. The Banco de España now suggests extending offline payments.',
    sources: [{ label: 'Banco de España', url: 'https://www.bde.es/f/webbe/GAP/Secciones/Publicaciones/InformesBoletinesRevistas/RevistaEstabilidadFinanciera/25/3_FSR49_Apagon.pdf' }],
  },
  {
    date: '6 Mar 2025',
    year: 2025,
    kind: 'ordered',
    title: 'An exchange seized, every service suspended',
    text: 'US, German and Finnish authorities seized the domains and servers of the Garantex exchange. It suspended all its services, withdrawals included.',
    sources: [{ label: 'US Department of Justice', url: 'https://www.justice.gov/opa/pr/garantex-cryptocurrency-exchange-disrupted-international-operation' }],
  },

  // ------------------------------------------------------------------ 2024
  {
    date: '19 Jul 2024',
    year: 2024,
    kind: 'outage',
    title: 'One faulty security update crashes 8.5 million computers',
    text: 'A bad update to CrowdStrike’s security software crashed Windows machines around the world. Banks, retailers, brokerages and rail networks were disrupted, and airlines halted flights.',
    sources: [{ label: 'TechCrunch', url: 'https://techcrunch.com/2024/07/20/microsoft-says-8-5m-windows-devices-were-affected-by-crowdstrike-outage/' }],
  },
  {
    date: 'From 11 May 2024',
    year: 2024,
    kind: 'ordered',
    title: 'A fintech middleman goes bust, and savings freeze',
    text: 'Bankrupt Synapse cut off the system its partner banks used to process transactions for apps such as Yotta and Juno. Their customers lost access to their money. Six months later, some were still locked out, and up to $96 million was unaccounted for.',
    sources: [
      { label: 'NBC News, May 2024', url: 'https://www.nbcnews.com/business/consumer/collapse-fintech-firm-10-million-users-without-access-money-rcna153599' },
      { label: 'NBC News, Nov 2024', url: 'https://www.nbcnews.com/business/consumer/-no-money-thousands-americans-see-their-savings-vanish-synapse-fintech-crisi-rcna181419' },
    ],
  },

  // ------------------------------------------------------------------ 2022
  {
    date: '2–3 Mar 2022',
    year: 2022,
    kind: 'ordered',
    title: 'A sanctions setting locks Venezuelans out of MetaMask',
    text: 'Infura, the provider MetaMask uses by default, applied new sanctions settings “more broadly than they needed to be”. Users in Venezuela were locked out of the wallet until the next day. Their coins never moved: the way to them was closed.',
    sources: [{ label: 'The Block', url: 'https://www.theblock.co/linked/136256' }],
  },

  // ------------------------------------------------------------------ 2020
  {
    date: '11 Nov 2020',
    year: 2020,
    kind: 'outage',
    title: 'An old bug at one provider freezes Ethereum withdrawals',
    text: 'Infura ran an old Ethereum client with “a critical consensus bug”, and its API went down. MetaMask, which uses Infura by default, ran into trouble, and Binance and Bithumb paused ETH and ERC-20 withdrawals.',
    sources: [{ label: 'The Block', url: 'https://www.theblock.co/post/84232/infura-outage-metamask-issues' }],
  },
];
