import { Section } from '../components/Section.tsx';

/** Where trust is needed in a banknote's life (docs/protocol.md §10, §12). */
const PHASES = [
  {
    name: 'Creation',
    who: 'Trusted, and bounded',
    text: 'The issuance server checks the payment, checks that the chip was born at the issuer’s factory, and funds the banknote before the NEAR MPC network signs its certificate. A public contract limits what any issuance server can do, hacked or not.',
  },
  {
    name: 'Circulation',
    who: 'Nobody in the middle',
    text: 'Just a phone and a chip, offline. Nobody can block a transfer, freeze a banknote in someone’s pocket or switch circulation off.',
  },
  {
    name: 'Redemption',
    who: 'The holder decides',
    text: 'The chip signs one withdrawal from its own account, and only with the holder’s PIN.',
  },
];

export function Trust() {
  return (
    <Section
      id="trust"
      eyebrow="Trust model"
      title={
        <>
          Trusted once. <em>Then it’s yours.</em>
        </>
      }
      lead="Every currency needs someone to vouch for it when it is issued. NearCash keeps that trust to the moment of creation and bounds it with a public contract. After that, a banknote doesn’t need anyone’s permission."
    >
      <ol className="phases">
        {PHASES.map((phase) => (
          <li key={phase.name} className="phase">
            <span className="phase__name">{phase.name}</span>
            <span className="phase__who">{phase.who}</span>
            <p>{phase.text}</p>
          </li>
        ))}
      </ol>

    </Section>
  );
}
