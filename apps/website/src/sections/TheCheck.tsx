import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { Section } from '../components/Section.tsx';
import { useInViewOnce, usePrefersReducedMotion } from '../hooks.ts';

/**
 * The four checks a phone runs on a banknote (docs/protocol.md §9,
 * "Exchange"). They light up one by one when the list scrolls into view.
 */
const CHECKS = [
  {
    title: 'It is in circulation',
    text: 'The chip reports its state. Only an issued, unspent banknote can pass. Blank notes and spent notes stop here.',
    code: 'INFO → state = ISSUED',
  },
  {
    title: 'Its certificate is genuine',
    text: 'The certificate is signed by the NEAR MPC network for the NearCash issuer contract. The public key is built into the app, so there is nothing to look up.',
    code: 'GET_CERT → ECDSA secp256k1 ✓',
  },
  {
    title: 'The certificate is for this chip',
    text: 'The certificate names the chip’s two public keys. They must match the keys the chip reports, so a certificate copied onto another banknote is useless.',
    code: 'cert.pubA = A · cert.pubF = F',
  },
  {
    title: 'The chip proves it holds the key',
    text: 'The phone sends 32 fresh random bytes and the chip signs them with a key that never leaves it. A clone or a recording can’t answer a challenge it has never seen.',
    code: 'AUTH(random challenge) ✓',
  },
];

export function TheCheck() {
  const reducedMotion = usePrefersReducedMotion();
  const [listRef, inView] = useInViewOnce<HTMLOListElement>();
  const [lit, setLit] = useState(0);

  // Once in view, light the next check every 450 ms until all are lit
  // (all at once if the reader prefers reduced motion).
  useEffect(() => {
    if (!inView || lit >= CHECKS.length) return;
    if (reducedMotion) {
      setLit(CHECKS.length);
      return;
    }
    const timer = setTimeout(() => setLit(lit + 1), 450);
    return () => clearTimeout(timer);
  }, [inView, lit, reducedMotion]);

  return (
    <Section
      id="check"
      eyebrow="The check"
      title={
        <>
          What a phone checks, <em>with no internet at all.</em>
        </>
      }
      lead="Accepting a banknote takes four checks between the phone and the chip, over NFC. Each one stops a different kind of fake."
    >
      <ol className="checks" ref={listRef}>
        {CHECKS.map((check, index) => (
          <li key={check.title} className={`check ${index < lit ? 'is-lit' : ''}`}>
            <span className="check__mark">
              <Icon name="check" size={18} />
            </span>
            <div>
              <h3>{check.title}</h3>
              <p>{check.text}</p>
              <code>{check.code}</code>
            </div>
          </li>
        ))}
      </ol>
      <p className={`verdict ${lit === CHECKS.length ? 'is-lit' : ''}`}>
        <Icon name="check" size={20} />
        <span>
          <strong>Valid banknote.</strong> Network requests: 0. Servers asked: 0.
        </span>
      </p>
    </Section>
  );
}
