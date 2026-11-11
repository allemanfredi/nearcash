import { Icon, type IconName } from '../components/Icon.tsx';
import { Section } from '../components/Section.tsx';

/**
 * What exists and runs today, part by part, and what comes next. Mirrors
 * README "The system" and docs/protocol.md §10: a reader should be able
 * to tell what is real from what is still a plan.
 */
const PARTS: { icon: IconName; name: string; status: 'Running'; text: string }[] = [
  {
    icon: 'chip',
    name: 'The banknote',
    status: 'Running',
    text: 'A Java Card with an NFC chip, running the NearCash applet. Its keys are born in the chip and never leave it: one proves the banknote is genuine, one owns its account and signs exactly once.',
  },
  {
    icon: 'atm',
    name: 'The ATM',
    status: 'Running',
    text: 'A working machine: a screen, a cassette of blank notes, an NFC reader and a dispenser. It sells a banknote end to end, from the QR code you pay to the note that drops out.',
  },
  {
    icon: 'phone',
    name: 'The wallet app',
    status: 'Running',
    text: 'A native iPhone app. It checks a banknote offline over NFC, lets the receiver take it over with a new PIN, and redeems it to any chain through NEAR Intents.',
  },
  {
    icon: 'server',
    name: 'The issuance server',
    status: 'Running',
    text: 'Takes real payments in USDC on any chain through NEAR Intents, into the reserve inside Confidential Intents. It funds each banknote from the reserve, and sends back whatever can’t become a banknote.',
  },
  {
    icon: 'network',
    name: 'The issuer contract and NEAR MPC',
    status: 'Running',
    text: 'The contract checks each chip’s birth and the issuance rules, then the NEAR MPC network signs the certificate.',
  },
];

/** What comes next, in order. Each one is a known gap, not a wish. */
const NEXT = [
  {
    title: 'An issuer nobody has to trust',
    text: 'Today the issuance server is trusted to fund a banknote before asking for its certificate. The plan: run it inside verifiable off-chain compute on NEAR (OutLayer), so the reserve’s key is born in an enclave and a certificate can only follow a real payment.',
  },
  {
    title: 'Mainnet',
    text: 'Issuer contract and MPC on NEAR mainnet, a production key ceremony for the chips, and the first cassette of banknotes born at the factory.',
  },
  {
    title: 'Everyday amounts first',
    text: 'The PIN travels in the clear over NFC and a chip is only as strong as its hardware. NearCash starts with small denominations, below what attacking a chip would cost, and adds a secure channel next.',
  },
];

export function Built() {
  return (
    <Section
      id="built"
      eyebrow="What exists today"
      title={
        <>
          Not a deck. <em>A machine that sells banknotes.</em>
        </>
      }
      lead="Everything on this page runs: the chip software, the ATM, the phone app, the issuance server and the contract. A customer has paid one USDC from another chain, watched the ATM make a banknote, and held it."
    >
      <div className="built">
        <figure className="built__figure">
          <img src="./atm.png" alt="The NearCash ATM: a phone on top as its screen, and a banknote coming out of the front" width={910} height={1025} loading="lazy" />
          <figcaption>The ATM. The screen is a phone; the banknote comes out of the front.</figcaption>
        </figure>

        <ul className="parts" aria-label="The parts of NearCash and their status">
          {PARTS.map((part) => (
            <li key={part.name} className="part">
              <span className="part__icon">
                <Icon name={part.icon} size={20} />
              </span>
              <div>
                <h3>
                  {part.name}
                  <span className="part__status">{part.status}</span>
                </h3>
                <p>{part.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <h3 className="next__title">What comes next</h3>
      <ol className="next">
        {NEXT.map((item, index) => (
          <li key={item.title} className="next__item">
            <span className="next__index">0{index + 1}</span>
            <h4>{item.title}</h4>
            <p>{item.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
