import { Section } from '../components/Section.tsx';

/**
 * The business, for a reader deciding whether to back it: who issues
 * banknotes, who buys them, why they are cheap to issue, and where an
 * issuer earns. The prototype itself sells at face value and charges
 * nothing: the levers below are what a live issuer can switch on.
 */
const ROLES = [
  {
    name: 'Who issues',
    text: 'An issuer that holds the reserve: a bank, an exchange, a fintech, a payment company. NearCash is everything an issuer needs: the chip software, the ATM, the issuance server, the contract and the phone app. For the prototype, the issuer is us.',
  },
  {
    name: 'Who buys',
    text: 'People who hold crypto and want some of it in a drawer, the way central banks now tell them to keep euros. Anyone in a country where the internet gets switched off. Markets, festivals and shops that want a payment that still works when the terminal doesn’t. Anyone handing money to someone in person.',
  },
  {
    name: 'Who accepts',
    text: 'Anyone with a phone. Accepting a banknote needs no account, no onboarding and no network: the app checks it in a tap. That is what lets a banknote move through many hands before someone cashes it in.',
  },
];

/** Why issuing a NearCash banknote costs a fraction of handling cash. */
const COSTS = [
  { label: 'Vault, armoured van, insurance', value: 'None', text: 'The ATM holds blank notes and no keys. There is nothing to guard and nothing to deliver.' },
  { label: 'A banknote, before it is sold', value: 'A blank card', text: 'A chip card with no value on it. It becomes money only after the customer’s payment has settled.' },
  { label: 'Settlement and refunds', value: 'Automatic', text: 'NEAR Intents moves the payment and the redemption. Whatever can’t become a banknote goes back to the address that paid.' },
  { label: 'Servers in the way of a payment', value: 'Zero', text: 'Checking and handing over a banknote cost the issuer nothing: no phone calls home.' },
];

/** Where an issuer can earn. Not switched on in the prototype. */
const LEVERS = [
  { name: 'An issuance fee', text: 'A small fee on each banknote sold, as prepaid cards and money orders charge today.' },
  { name: 'A redemption spread', text: 'The customer chooses the token and the chain to cash in to; the issuer prices the conversion.' },
  { name: 'ATM placement', text: 'With nothing to steal, an ATM goes where a vault never could: a shop counter, a hotel desk, a festival gate.' },
  { name: 'The stack, licensed', text: 'Banks and exchanges issue their own banknotes on NearCash, under their own brand and reserve.' },
];

export function Business() {
  return (
    <Section
      id="business"
      eyebrow="The business"
      title={
        <>
          Cash is a product. <em>Someone has to sell it.</em>
        </>
      }
      lead="A banknote is issued once, changes hands many times and is cashed in once. The issuer is paid for the first step, pays nothing for the second, and prices the third. The prototype sells at face value: you pay exactly the banknote’s value, in USDC on any chain, and the issuer covers the conversion."
    >
      <div className="roles">
        {ROLES.map((role) => (
          <article key={role.name} className="role">
            <h3>{role.name}</h3>
            <p>{role.text}</p>
          </article>
        ))}
      </div>

      <div className="economics">
        <div>
          <h3 className="economics__title">What it costs to issue</h3>
          <dl className="costs">
            {COSTS.map((cost) => (
              <div key={cost.label} className="cost">
                <dt>{cost.label}</dt>
                <dd className="cost__value">{cost.value}</dd>
                <dd className="cost__text">{cost.text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3 className="economics__title">Where an issuer earns</h3>
          <ul className="levers">
            {LEVERS.map((lever) => (
              <li key={lever.name} className="lever">
                <h4>{lever.name}</h4>
                <p>{lever.text}</p>
              </li>
            ))}
          </ul>
          <p className="footnote">The prototype charges none of these. They are the issuer’s to switch on.</p>
        </div>
      </div>
    </Section>
  );
}
