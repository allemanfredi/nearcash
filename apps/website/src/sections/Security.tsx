import { Icon, type IconName } from '../components/Icon.tsx';
import { Section } from '../components/Section.tsx';

/** Why a banknote can't be faked, stolen from the ATM or spent twice. */
const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'chip',
    title: 'Keys born in a chip the issuer made',
    text: 'Both key pairs are generated in the banknote’s chip and never leave it: nobody ever sees them, not even the ATM that sold it. The chip itself carries a birth certificate signed by an offline production key, so keys made anywhere else are refused.',
  },
  {
    icon: 'once',
    title: 'Signs once, then never again',
    text: 'Redeeming and marking the banknote spent happen in one atomic step on the chip. There is no second signature to steal and no way to spend twice.',
  },
  {
    icon: 'network',
    title: 'Certified by a network, not a server',
    text: 'Certificates are signed by the NEAR MPC network. No single machine holds the issuer key, so there is no key on our side to steal or leak.',
  },
  {
    icon: 'atm',
    title: 'The ATM doesn’t print money',
    text: 'ATMs hold no keys and sell blank notes. Value is created only after the issuance server has seen the payment itself. A stolen cassette is just a stack of blank notes.',
  },
  {
    icon: 'contract',
    title: 'Limits written in a contract',
    text: 'The issuer contract signs only for chips the issuer made, each once, in set denominations, up to a daily cap. It keeps public counters and can cut off an issuance server instantly.',
  },
  {
    icon: 'eyeOff',
    title: 'Private by design',
    text: 'You pay into a reserve inside Confidential Intents, and the banknote is funded from it inside Confidential Intents too. The certificate records only the day of issue. Nothing public links a buyer to a banknote.',
  },
];

export function Security() {
  return (
    <Section
      id="security"
      eyebrow="Security and privacy"
      title={
        <>
          Hard to fake. <em>Impossible to spend twice.</em>
        </>
      }
    >
      <div className="features">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="feature">
            <span className="feature__icon">
              <Icon name={feature.icon} size={22} />
            </span>
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
