import { useId } from 'react';
import { rosette, waveBand } from './guilloche.ts';

/**
 * A NearCash banknote, drawn as a real banknote (not a bank card): long
 * proportions, an engraved double frame with microtext, the denomination in
 * the corners, a serial number, a security thread and guilloché patterns.
 *
 * The chip takes the place of the portrait, inside the watermark medallion:
 * on a NearCash banknote it is the chip that vouches for the note.
 *
 * Everything is one SVG in a 1300 × 620 coordinate space, so text and
 * artwork scale together. Fonts come from the page (classes in styles.css).
 */

const W = 1300;
const H = 620;
/** Centre of the medallion that holds the chip. */
const MEDALLION = { cx: 330, cy: 310 };

// The patterns never change: compute them once, when the module loads.
const ROSETTES = [
  rosette({ ...MEDALLION, R: 150, r: 90, d: 118, scale: 1.3 }),
  rosette({ ...MEDALLION, R: 160, r: 56, d: 74, scale: 1.3 }),
  rosette({ ...MEDALLION, R: 105, r: 63, d: 40, scale: 1.3 }),
];
const SMALL_ROSETTE = rosette({ cx: 1120, cy: 430, R: 120, r: 45, d: 62, scale: 1 });
const WAVES = [
  ...waveBand({ width: W, y: 96, amplitude: 16, wavelength: 260, count: 7 }),
  ...waveBand({ width: W, y: 524, amplitude: 16, wavelength: 260, count: 7 }),
];
const MICROTEXT = 'NEARCASH · BEARER BANKNOTE · '.repeat(8);

export function Banknote({
  amount,
  symbol,
  serial = 'NC 4F2A 91B7',
  className = '',
}: {
  amount: string;
  symbol: string;
  /** Printed serial number; purely decorative. */
  serial?: string;
  className?: string;
}) {
  // Gradient ids must be unique: several banknotes share the page.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const paper = `${id}-paper`;
  const glow = `${id}-glow`;
  const gold = `${id}-gold`;
  const thread = `${id}-thread`;
  const lines = `${id}-lines`;

  return (
    <svg
      className={`banknote ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`NearCash banknote, ${amount} ${symbol}`}
    >
      <defs>
        <linearGradient id={paper} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8ff8d0" />
          <stop offset="0.45" stopColor="#00ec97" />
          <stop offset="1" stopColor="#00b877" />
        </linearGradient>
        {/* The watermark: lighter paper inside the medallion. */}
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6e9c0" />
          <stop offset="1" stopColor="#b3954f" />
        </linearGradient>
        {/* Metallic thread: dark edges, a bright core. */}
        <linearGradient id={thread} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2f4d42" />
          <stop offset="0.5" stopColor="#e9f5ef" />
          <stop offset="1" stopColor="#2f4d42" />
        </linearGradient>
        {/* Fine engraved lines across the whole note. */}
        <pattern id={lines} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
          <line x1="0" y1="0" x2="0" y2="7" className="banknote__hatch" strokeWidth="1" />
        </pattern>
      </defs>

      {/* Paper. */}
      <rect width={W} height={H} rx="22" fill={`url(#${paper})`} />
      <rect width={W} height={H} rx="22" fill={`url(#${lines})`} />

      {/* Guilloché: wave bands top and bottom, rosettes behind the medallion and the value. */}
      <g className="banknote__engraving" fill="none" strokeWidth="1.2">
        {WAVES.map((d) => (
          <path key={d.slice(0, 32)} d={d} />
        ))}
        {ROSETTES.map((d) => (
          <path key={d.slice(0, 32)} d={d} />
        ))}
        <path d={SMALL_ROSETTE} />
      </g>

      {/* Engraved double frame. */}
      <rect x="24" y="24" width={W - 48} height={H - 48} rx="12" className="banknote__frame" strokeWidth="2.5" />
      <rect x="36" y="36" width={W - 72} height={H - 72} rx="8" className="banknote__frame banknote__frame--thin" strokeWidth="1" />

      {/* Microtext along the frame. */}
      <text x="60" y="56" className="banknote__micro" textLength={W - 120} lengthAdjust="spacing">
        {MICROTEXT}
      </text>
      <text x="60" y={H - 46} className="banknote__micro" textLength={W - 120} lengthAdjust="spacing">
        {MICROTEXT}
      </text>

      {/* Watermark medallion with a beaded border, and the chip as its portrait. */}
      <ellipse cx={MEDALLION.cx} cy={MEDALLION.cy} rx="150" ry="186" fill={`url(#${glow})`} />
      <ellipse cx={MEDALLION.cx} cy={MEDALLION.cy} rx="150" ry="186" className="banknote__frame" strokeWidth="1.5" />
      <ellipse cx={MEDALLION.cx} cy={MEDALLION.cy} rx="164" ry="200" className="banknote__frame banknote__frame--beads" strokeWidth="3" />
      <g>
        <rect x={MEDALLION.cx - 72} y={MEDALLION.cy - 56} width="144" height="112" rx="20" fill={`url(#${gold})`} />
        <g fill="none" stroke="rgb(80 60 20 / 0.45)" strokeWidth="3">
          <rect x={MEDALLION.cx - 72} y={MEDALLION.cy - 56} width="144" height="112" rx="20" />
          <rect x={MEDALLION.cx - 24} y={MEDALLION.cy - 30} width="48" height="60" rx="8" />
          <path d={`M${MEDALLION.cx - 72} ${MEDALLION.cy - 18}h48 M${MEDALLION.cx + 24} ${MEDALLION.cy - 18}h48 M${MEDALLION.cx - 72} ${MEDALLION.cy + 18}h48 M${MEDALLION.cx + 24} ${MEDALLION.cy + 18}h48`} />
        </g>
      </g>
      {/* Contactless mark, to the right of the chip. */}
      <g className="banknote__ink-line" fill="none" strokeWidth="5" strokeLinecap="round">
        <path d={`M${MEDALLION.cx + 88} ${MEDALLION.cy - 12}a14 14 0 0 1 0 24`} />
        <path d={`M${MEDALLION.cx + 100} ${MEDALLION.cy - 24}a28 28 0 0 1 0 48`} />
        <path d={`M${MEDALLION.cx + 112} ${MEDALLION.cy - 36}a42 42 0 0 1 0 72`} />
      </g>

      {/* Security thread. */}
      <rect x="533" y="0" width="14" height={H} fill={`url(#${thread})`} className="banknote__thread" />

      {/* Corner denominations. */}
      <text x="66" y="128" className="banknote__numeral banknote__numeral--corner">
        {amount}
      </text>
      <text x={W - 66} y="128" textAnchor="end" className="banknote__numeral banknote__numeral--corner">
        {amount}
      </text>
      <text x="66" y={H - 66} className="banknote__numeral banknote__numeral--small">
        {amount}
      </text>

      {/* Title. */}
      <text x="905" y="138" textAnchor="middle" className="banknote__title">
        NEARCASH
      </text>
      <text x="905" y="176" textAnchor="middle" className="banknote__caps">
        BEARER BANKNOTE
      </text>

      {/* Serial number. */}
      <text x={W - 68} y="236" textAnchor="end" className="banknote__serial">
        {serial}
      </text>

      {/* The value. */}
      <text x={W - 68} y="336" textAnchor="end" className="banknote__currency">
        {symbol}
      </text>
      <text x={W - 60} y={H - 74} textAnchor="end" className="banknote__numeral banknote__numeral--main">
        {amount}
      </text>

      {/* Fine print. */}
      <text x="590" y={H - 112} className="banknote__caps banknote__caps--fine">
        BACKED ON NEAR INTENTS
      </text>
      <text x="590" y={H - 84} className="banknote__caps banknote__caps--fine">
        CERTIFIED BY NEAR MPC
      </text>
    </svg>
  );
}
