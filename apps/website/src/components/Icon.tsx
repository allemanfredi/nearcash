/**
 * The site's icons: simple 24×24 line drawings that inherit the text colour.
 * Decorative by default (aria-hidden); the text next to them carries the meaning.
 */
export type IconName =
  | 'check'
  | 'cross'
  | 'nfc'
  | 'chip'
  | 'lock'
  | 'once'
  | 'network'
  | 'atm'
  | 'contract'
  | 'eyeOff'
  | 'server'
  | 'phone'
  | 'user'
  | 'chain'
  | 'plug'
  | 'arrowRight'
  | 'arrowUpRight';

const paths: Record<IconName, string[]> = {
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  cross: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  nfc: ['M8 9a4.5 4.5 0 0 1 0 6', 'M11.5 6.5a8 8 0 0 1 0 11', 'M15 4a11.5 11.5 0 0 1 0 16'],
  chip: ['M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z', 'M4 10h5v4H4', 'M15 10h5v4h-5', 'M9 4v16', 'M15 4v16'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  once: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z', 'M10.5 9l2-1.5V16'],
  network: ['M12 5a2 2 0 1 0 0 .01', 'M5 17a2 2 0 1 0 0 .01', 'M19 17a2 2 0 1 0 0 .01', 'M11 7l-5 8.5', 'M13 7l5 8.5', 'M7 17h10'],
  atm: ['M5 3h14v12H5z', 'M8 6h8v5H8z', 'M8 15v3h8v-3', 'M10 18v3h4v-3'],
  contract: ['M7 3h7l4 4v14H7z', 'M14 3v4h4', 'M10 12h5', 'M10 16h5'],
  eyeOff: ['M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2', 'M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2', 'M10 10.2a2.5 2.5 0 0 0 3.8 3.3', 'M4 4l16 16'],
  server: ['M4 5h16v6H4z', 'M4 13h16v6H4z', 'M7.5 8h.01', 'M7.5 16h.01'],
  phone: ['M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z', 'M11 18h2'],
  user: ['M12 4a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z', 'M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5'],
  chain: ['M10 14l4-4', 'M8.5 11.5L6.8 13.2a3 3 0 0 0 4.2 4.2l1.7-1.7', 'M15.5 12.5l1.7-1.7a3 3 0 0 0-4.2-4.2l-1.7 1.7'],
  plug: ['M9 3v5', 'M15 3v5', 'M6.5 8h11v3a5.5 5.5 0 0 1-11 0z', 'M12 16.5V21'],
  arrowRight: ['M5 12h14', 'M13 6l6 6l-6 6'],
  arrowUpRight: ['M7 17L17 7', 'M9 7h8v8'],
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
