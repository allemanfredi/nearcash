import { Section } from '../components/Section.tsx';

/** The ATM, and why there is nothing in it worth stealing (docs/protocol.md §12). */
const POINTS = [
  {
    title: 'Blank notes in the cassette',
    text: 'The notes inside have no value and no keys. Each chip creates its own keys at the moment of sale.',
  },
  {
    title: 'No keys inside',
    text: 'The ATM can’t decide that a sale is paid, and it can’t sign anything. Open it, rewire it, carry it away: all you get is plastic.',
  },
  {
    title: 'Small, cheap, anywhere',
    text: 'With nothing to guard, an ATM needs no vault, no armoured van and no cash logistics. A screen, an NFC reader and a dispenser are enough.',
  },
];

export function Atm() {
  return (
    <Section
      id="atm"
      eyebrow="The ATM"
      title={
        <>
          An ATM with <em>nothing worth stealing.</em>
        </>
      }
      lead="A normal ATM is a vault because it is full of money. A NearCash ATM is full of blank notes. Value is created only after the issuance server has seen your payment, so the machine itself holds nothing of value."
    >
      <div className="atm">
        <AtmIllustration />
        <ul className="atm__points">
          {POINTS.map((point) => (
            <li key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/** A simple line drawing: the housing, its screen, the slot, a banknote coming out. */
function AtmIllustration() {
  return (
    <svg className="atm__art" viewBox="0 0 320 380" role="img" aria-label="Drawing of a NearCash ATM dispensing a banknote">
      <defs>
        <linearGradient id="atm-note" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00ec97" />
          <stop offset="1" stopColor="#00c47e" />
        </linearGradient>
      </defs>
      {/* Housing. */}
      <rect x="40" y="20" width="240" height="300" rx="26" className="atm__body" />
      {/* Display. */}
      <rect x="100" y="48" width="120" height="150" rx="16" className="atm__phone" />
      <rect x="110" y="62" width="100" height="122" rx="8" className="atm__screen" />
      <text x="160" y="104" textAnchor="middle" className="atm__screen-text">
        10 USDC
      </text>
      <text x="160" y="124" textAnchor="middle" className="atm__screen-sub">
        Paid · issuing note
      </text>
      <rect x="122" y="142" width="76" height="22" rx="11" className="atm__screen-button" />
      {/* Banknote slot. */}
      <rect x="70" y="246" width="180" height="12" rx="6" className="atm__slot" />
      {/* The banknote coming out: frame, chip in its medallion, value. */}
      <g className="atm__card">
        <rect x="84" y="252" width="152" height="72" rx="4" fill="url(#atm-note)" />
        <rect x="89" y="257" width="142" height="62" rx="2" fill="none" stroke="#032619" strokeOpacity="0.5" />
        <ellipse cx="114" cy="288" rx="15" ry="19" fill="#ffffff" fillOpacity="0.45" stroke="#032619" strokeOpacity="0.4" />
        <rect x="107" y="282" width="14" height="11" rx="2.5" fill="#d8c48a" />
        <line x1="138" y1="252" x2="138" y2="324" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="2" strokeDasharray="5 2" />
        <text x="227" y="313" textAnchor="end" className="atm__note-value">
          10
        </text>
      </g>
      {/* Feet. */}
      <rect x="64" y="320" width="40" height="14" rx="4" className="atm__body" />
      <rect x="216" y="320" width="40" height="14" rx="4" className="atm__body" />
    </svg>
  );
}
