import { Icon, type IconName } from '../components/Icon.tsx';
import { Section } from '../components/Section.tsx';

/**
 * The NEAR stack NearCash is built on, and why each piece is needed:
 * for each one, what NearCash would lose without it (docs/protocol.md
 * §7, §11, §12 and README "The system").
 */
const PILLARS: { icon: IconName; name: string; role: string; text: string; without: string }[] = [
  {
    icon: 'chain',
    name: 'NEAR Intents',
    role: 'Pay from any chain, redeem to any chain',
    text: 'At the ATM you pay in the token you already hold, on the chain it lives on, through NEAR Intents. When you redeem, the banknote’s value goes to the token, chain and address you choose. The ATM never touches your chain at all.',
    without: 'One ATM per chain, and a bridge to trust in between.',
  },
  {
    icon: 'eyeOff',
    name: 'Confidential Intents',
    role: 'Every banknote has its own private account',
    text: 'The issuer’s reserve and each banknote’s account live inside Confidential Intents (FAR). The payment lands in the reserve, the banknote is funded from it in private, and the certificate records only the day. Nothing public links a buyer to a banknote.',
    without: 'A public chain would show who bought which banknote, and when it was cashed in.',
  },
  {
    icon: 'network',
    name: 'NEAR MPC (chain signatures)',
    role: 'The issuer key exists nowhere',
    text: 'Certificates are signed by the NEAR MPC network. The key is split among its nodes, a signature needs many of them to agree, and no server or person ever holds it whole. Any phone can check a banknote against one public key, forever.',
    without: 'A key file on the issuer’s server: the one thing a hacker would need to print money.',
  },
  {
    icon: 'contract',
    name: 'A NEAR smart contract',
    role: 'The rules the issuer cannot break',
    text: 'The MPC network signs only what the issuer contract asks for: chips the issuer made, each once, in set denominations, under a daily cap, with public counters. The contract can cut an issuance server off instantly, without touching the key in anyone’s wallet.',
    without: 'A hacked issuer server would be a hacked mint.',
  },
];

export function BuiltOnNear() {
  return (
    <Section
      id="near"
      eyebrow="Built on NEAR"
      title={
        <>
          Four pieces of NEAR. <em>None of them optional.</em>
        </>
      }
      lead="NearCash is not a wallet with a card attached. It needs money that can be paid from any chain, held in private, certified by nobody in particular and bounded by code. NEAR has all four."
    >
      <div className="pillars">
        {PILLARS.map((pillar) => (
          <article key={pillar.name} className="pillar">
            <div className="pillar__head">
              <span className="pillar__icon">
                <Icon name={pillar.icon} size={22} />
              </span>
              <div>
                <h3>{pillar.name}</h3>
                <p className="pillar__role">{pillar.role}</p>
              </div>
            </div>
            <p className="pillar__text">{pillar.text}</p>
            <p className="pillar__without">
              <span>Without it</span>
              {pillar.without}
            </p>
          </article>
        ))}
      </div>
    </Section>
  );
}
