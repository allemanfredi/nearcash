import { Icon, type IconName } from '../components/Icon.tsx';
import { Section } from '../components/Section.tsx';

/**
 * The path a payment from a typical crypto app travels. Every server on it
 * is run by someone, somewhere, and can stop.
 */
const PATH: { label: string; detail: string; icon: IconName; server: boolean }[] = [
  { label: 'You', detail: 'own the coins', icon: 'user', server: false },
  { label: 'Wallet backend', detail: 'balances, prices, sending', icon: 'server', server: true },
  { label: 'RPC provider', detail: 'reads and writes the chain', icon: 'server', server: true },
  { label: 'Cloud and CDN', detail: 'host all of the above', icon: 'server', server: true },
  { label: 'Blockchain', detail: 'never stops', icon: 'chain', server: false },
];

/** Three ways a server goes away. */
const FAILURES = [
  {
    title: 'Hacked',
    text: 'An exchange or a wallet backend is breached. Withdrawals are halted while the damage is counted, sometimes for days.',
  },
  {
    title: 'Patched in a panic',
    text: 'A critical flaw is found in software everyone runs. Services are pulled offline until they are fixed, whoever depends on them.',
  },
  {
    title: 'Switched off',
    text: 'An authority, a provider or a power grid switches a service off. The reason doesn’t matter: the service is gone either way.',
  },
];

export function Problem() {
  return (
    <Section
      id="problem"
      eyebrow="The problem"
      title={
        <>
          Your coins are on-chain. <em>The way to them isn’t.</em>
        </>
      }
      lead="Blockchains are built never to stop. The apps we use to reach them are not. Between you and your money sit a wallet backend, an RPC provider, a cloud region, a CDN, often an exchange. Each one is a server someone can hack, patch in a hurry or switch off. Each one is an off switch for your money."
    >
      <ol className="path" aria-label="The path of a payment from a crypto app">
        {PATH.map((step) => (
          <li key={step.label} className={`path__node ${step.server ? 'path__node--server' : ''}`}>
            <span className="path__icon">
              <Icon name={step.icon} size={22} />
            </span>
            <span className="path__label">{step.label}</span>
            <span className="path__detail">{step.detail}</span>
            {step.server && <span className="path__tag">off switch</span>}
          </li>
        ))}
      </ol>

      <div className="failures">
        {FAILURES.map((failure, index) => (
          <article key={failure.title} className="failure">
            <span className="failure__index">0{index + 1}</span>
            <h3>{failure.title}</h3>
            <p>{failure.text}</p>
          </article>
        ))}
      </div>

      <figure className="question">
        <blockquote>
          <p>What happens if you own crypto and, suddenly, you can’t spend it?</p>
        </blockquote>
        <figcaption>
          You still own it, but you can’t pay rent with it, buy food with it or send it to someone who
          needs it. In a crisis, money you can’t spend is close to money you don’t have.
        </figcaption>
      </figure>
    </Section>
  );
}
