import { Icon, type IconName } from '../components/Icon.tsx';
import { Section } from '../components/Section.tsx';

/** The life of a banknote, in three steps. Mirrors docs/protocol.md §9. */
const STEPS: { title: string; icon: IconName; text: string; offline: boolean; detail: string }[] = [
  {
    title: 'Buy it at an ATM',
    icon: 'atm',
    text: 'Pay with crypto from almost any chain, through NEAR Intents. The ATM takes a blank note and its chip creates its own keys. The banknote’s own account is funded, and the NEAR MPC network signs its certificate. You pick a PIN and the banknote drops out.',
    offline: false,
    detail: 'Needs the network, once',
  },
  {
    title: 'Pass it on, offline',
    icon: 'nfc',
    text: 'Hold it to any iPhone running the NearCash app. The phone checks the certificate and makes the chip prove it’s genuine, without the internet. Deal done? The giver tells the PIN and the new owner changes it on the spot.',
    offline: true,
    detail: 'No network, no server',
  },
  {
    title: 'Redeem it when you want',
    icon: 'once',
    text: 'Turn it back into on-chain money whenever you like. The banknote signs one withdrawal and marks itself spent in the same step. After that it can never sign again, and every phone will see it as spent.',
    offline: false,
    detail: 'Needs the network, once',
  },
];

export function HowItWorks() {
  return (
    <Section
      id="how"
      eyebrow="How it works"
      title={
        <>
          A banknote with a chip <em>for a vault.</em>
        </>
      }
      lead="Each NearCash banknote carries a chip. Its value sits in an account on NEAR Intents that only the chip can spend from. The network is needed when a banknote is born and when it is cashed in. In between, it passes from hand to hand like cash."
    >
      <ol className="steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className={`step ${step.offline ? 'step--offline' : ''}`}>
            <div className="step__head">
              <span className="step__icon">
                <Icon name={step.icon} size={24} />
              </span>
              <span className="step__number">Step {index + 1}</span>
            </div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
            <p className="step__detail">{step.detail}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
