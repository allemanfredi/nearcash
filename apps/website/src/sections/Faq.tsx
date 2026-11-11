import { Section } from '../components/Section.tsx';

/** Native <details>: accessible and keyboard-friendly with no JavaScript. */
const QUESTIONS = [
  {
    q: 'What happens to my banknotes if NearCash’s own servers go down?',
    a: 'They keep working. Checking a banknote and passing it on need no server, ours included. Only buying a new banknote and redeeming one need the network, and those can wait until it is back.',
  },
  {
    q: 'And if NearCash’s own server is hacked?',
    a: 'The attacker gets less than you would think. The server holds no issuer key: certificates are signed by the NEAR MPC network, only for what the issuer contract allows. They can’t make chips, because every chip carries a birth signature from an offline key. They can’t go above the set denominations or the daily cap, and everything they do shows in the contract’s public counters, after which the server is cut off in one call. What they could do is have genuine blank chips certified without paying for them, as many as they can lay hands on: bounded and visible. Closing that last gap is the first item on our roadmap.',
  },
  {
    q: 'Do I need internet to accept a banknote?',
    a: 'No. Your phone checks the certificate against the issuer key built into the NearCash app, then asks the chip to sign a fresh random challenge. Everything happens over NFC, between the phone and the banknote.',
  },
  {
    q: 'Can someone copy a banknote?',
    a: 'Copying the certificate is easy, but it is useless on its own. The phone makes the chip prove, every time, that it holds the private key named in the certificate. That key is generated inside the chip and never leaves it.',
  },
  {
    q: 'Can a banknote be spent twice?',
    a: 'No. The key that controls the funds signs exactly once, in the same atomic step that marks the banknote as spent. From then on, every phone sees it as spent.',
  },
  {
    q: 'Who can freeze my banknote?',
    a: 'NearCash has no freeze button. ATMs hold no keys, and once a banknote is out, nobody at NearCash can disable it. To be complete: the operator of Confidential Intents can technically freeze accounts there. NearCash never needs that power, and we recommend putting it behind a time-locked multisig.',
  },
  {
    q: 'What backs the value?',
    a: 'Each banknote has its own account on NEAR Intents, inside Confidential Intents, funded when it is sold. The account address is derived from a key inside the chip, so only the chip can sign the withdrawal.',
  },
  {
    q: 'Is it private?',
    a: 'Payments go to a reserve inside Confidential Intents, and banknotes are funded from it inside Confidential Intents too, so nothing public links a buyer to a banknote. The certificate records only the day of issue, not the time.',
  },
  {
    q: 'What if I lose it?',
    a: 'Like cash, a lost banknote is lost. But a finder can’t redeem it or pass it on without the PIN, and five wrong PINs lock it for good. That is also why NearCash is meant for everyday amounts, not savings.',
  },
  {
    q: 'Which phones work?',
    a: 'An iPhone with iOS 17 or later, running the NearCash app. It is a native app, built with SwiftUI and Core NFC.',
  },
  {
    q: 'Is it live?',
    a: 'It is a working prototype, built for a hackathon. The chip software, the ATM, the phone app and the issuance server run end to end: you pay in USDC from any chain through NEAR Intents, the money lands in the reserve inside Confidential Intents, and the banknote is funded from it. Certificates are signed by the real NEAR MPC network, on testnet. Mainnet is next.',
  },
];

export function Faq() {
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions, answered plainly.">
      <div className="faq">
        {QUESTIONS.map((item) => (
          <details key={item.q} className="faq__item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
