import { Banknote } from '../components/Banknote.tsx';
import { Icon } from '../components/Icon.tsx';

/** Every number here is a property of the design, not a benchmark. */
const FACTS = [
  { value: '0', label: 'servers needed to check a banknote' },
  { value: '1', label: 'signature from its funds key, in its whole life' },
  { value: '0', label: 'keys inside the ATM that sells it' },
];

export function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="container hero__grid">
        <div className="hero__copy">
          <p className="pill">
            <span className="pill__dot" aria-hidden="true" />
            {/* Each phrase stays on one line: on narrow phones the pill wraps at the dot. */}
            <span className="pill__text">
              <span>Backed by NEAR Intents</span> · <span>Certified by NEAR MPC</span>
            </span>
          </p>
          <h1 id="hero-title" className="hero__title">
            Cash that keeps working
            <br />
            <em>when everything else stops.</em>
          </h1>
          <p className="hero__lead">
            Servers get hacked, patched in a panic, ordered offline. Each time, people who hold crypto
            through apps find out they can’t spend it. NearCash puts the money in your hand: a real banknote,
            with a chip. Any phone checks it offline, and you pass it on like cash.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="#off-switch">
              Pull the plug on a wallet
              <Icon name="plug" size={18} />
            </a>
            <a className="button button--ghost" href="#how">
              How it works
              <Icon name="arrowRight" size={18} />
            </a>
          </div>
        </div>

        <div className="hero__visual">
          <div className="hero__note-stack">
            <Banknote amount="20" symbol="USDC" serial="NC 8D03 22C5" className="hero__note hero__note--back" />
            <Banknote amount="10" symbol="USDC" serial="NC 4F2A 91B7" className="hero__note hero__note--front" />
          </div>
          <p className="hero__caption">
            <Icon name="check" size={16} />
            Valid · checked offline over NFC
          </p>
        </div>
      </div>

      <div className="container">
        <dl className="facts">
          {FACTS.map((fact) => (
            <div key={fact.label} className="facts__item">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
