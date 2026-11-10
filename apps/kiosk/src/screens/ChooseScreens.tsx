/**
 * The first two steps: which banknote, and what to pay it with (the
 * network, then the token on it, and optionally a refund address).
 */
import { useState } from 'react';
import { type PaymentOption, type Setup, optionsOnNetwork, paymentNetworks, refundAddressProblem } from '@nearcash/kiosk-api';
import { Screen } from '../components/Screen.tsx';

export const STEPS_BEFORE_PAYING = 3;

export type Banknote = Setup['banknotes'][number];

/** How the customer pays. No refund address: refunds go back to the address the payment comes from. */
export type PaymentChoice = { option: PaymentOption; refundTo?: string };

export function AmountScreen({ setup, onChoose }: { setup: Setup; onChoose: (banknote: Banknote) => void }) {
  return (
    <Screen
      title={
        <>
          Cash you can <em>hold.</em>
        </>
      }
      lead="Pay with crypto, take a real banknote. Anyone can check it with a phone, even offline."
      step={{ current: 1, total: STEPS_BEFORE_PAYING }}
    >
      {setup.simulatedPayments && <SimulatedBadge />}
      {setup.dummyReader && <DummyReaderBadge />}
      <p className="label">Choose a banknote</p>
      {/* Up to three banknotes: one per row. More: a grid of three per row, so all fit on the screen. */}
      <div className={setup.banknotes.length > 3 ? 'notes notes--grid' : 'notes'}>
        {setup.banknotes.map((banknote) => (
          <button
            key={banknote.amount}
            type="button"
            className="note-button"
            aria-label={banknote.label}
            onClick={() => onChoose(banknote)}
          >
            <span className="note-button__value">{banknote.value}</span>
            <span className="note-button__symbol">{banknote.symbol}</span>
            <span className="note-button__chip" aria-hidden="true" />
          </button>
        ))}
      </div>
    </Screen>
  );
}

/**
 * Step 2: two choices, the network first and then the token on it. A
 * network with a single token picks it by itself; changing network keeps
 * the token when the new network has it too. Customers who pay from an
 * exchange can add a refund address (the exchange's sending address isn't
 * theirs, so a refund sent back there could be lost).
 */
export function MethodScreen({
  setup,
  banknote,
  initial,
  onChoose,
  onBack,
  onCancel,
}: {
  setup: Setup;
  banknote: Banknote;
  /** What was chosen before, when the customer comes back from the next step. */
  initial?: PaymentChoice;
  onChoose: (choice: PaymentChoice) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const networks = paymentNetworks(setup.paymentOptions);
  const [network, setNetwork] = useState<string | null>(initial?.option.network ?? null);
  const [option, setOption] = useState<PaymentOption | null>(initial?.option ?? null);
  const [refundOpen, setRefundOpen] = useState(Boolean(initial?.refundTo));
  const [refundTo, setRefundTo] = useState(initial?.refundTo ?? '');
  const [refundProblem, setRefundProblem] = useState<string | null>(null);

  const tokens = network ? optionsOnNetwork(setup.paymentOptions, network) : [];

  const chooseNetwork = (next: string) => {
    const available = optionsOnNetwork(setup.paymentOptions, next);
    setNetwork(next);
    // Keep the token if the new network has it; a network with one token picks it.
    setOption(available.find((candidate) => candidate.token === option?.token) ?? (available.length === 1 ? available[0]! : null));
    setRefundProblem(null);
  };

  const chooseToken = (id: string) => {
    setOption(tokens.find((candidate) => candidate.id === id) ?? null);
    setRefundProblem(null);
  };

  const submit = () => {
    if (!option) return;
    const address = refundOpen ? refundTo.trim() : '';
    if (address) {
      const problem = refundAddressProblem(option.addressKind, address);
      if (problem) {
        setRefundProblem(problem);
        return;
      }
    }
    onChoose(address ? { option, refundTo: address } : { option });
  };

  return (
    <Screen
      title="How do you want to pay?"
      lead={`For a ${banknote.label} banknote. Pick the network your wallet is on, then the token.`}
      step={{ current: 2, total: STEPS_BEFORE_PAYING }}
      onBack={onBack}
      onCancel={onCancel}
      actions={
        <button type="button" className="button button--primary" disabled={!option} onClick={submit}>
          Continue
        </button>
      }
    >
      <div className="field">
        <label className="label" htmlFor="network">
          Network
        </label>
        <select
          id="network"
          className="select"
          value={network ?? ''}
          onChange={(event) => chooseNetwork(event.target.value)}
        >
          <option value="" disabled>
            Choose a network
          </option>
          {networks.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="token">
          Token
        </label>
        <select
          id="token"
          className="select"
          value={option?.id ?? ''}
          disabled={!network}
          onChange={(event) => chooseToken(event.target.value)}
        >
          <option value="" disabled>
            {network ? 'Choose a token' : 'Choose a network first'}
          </option>
          {tokens.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.token}
            </option>
          ))}
        </select>
      </div>

      {refundOpen ? (
        <div className="field">
          <label className="label" htmlFor="refund-address">
            Refund address{option ? ` on ${option.network}` : ''}
          </label>
          <textarea
            id="refund-address"
            className="input"
            value={refundTo}
            onChange={(event) => {
              setRefundTo(event.target.value);
              setRefundProblem(null);
            }}
            rows={2}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholderFor(option)}
          />
          {refundProblem ? (
            <p className="error">{refundProblem}</p>
          ) : (
            <p className="note">If the payment can’t become a banknote, the money goes here instead of back to the exchange.</p>
          )}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setRefundOpen(false);
              setRefundTo('');
              setRefundProblem(null);
            }}
          >
            Remove the refund address
          </button>
        </div>
      ) : (
        <button type="button" className="link-button" onClick={() => setRefundOpen(true)}>
          Paying from an exchange? Add a refund address
        </button>
      )}
    </Screen>
  );
}

function placeholderFor(option: PaymentOption | null): string {
  switch (option?.addressKind) {
    case 'evm':
      return '0x…';
    case 'near':
      return 'name.near';
    case 'solana':
      return 'Solana address';
    default:
      return 'Your address';
  }
}

/** Development only: says no real money moves. */
export function SimulatedBadge() {
  return <p className="simulated">Test mode · payments are simulated, no real money moves</p>;
}

/** Testing the mechanics with the printed dummy reader: says the card comes out blank. */
export function DummyReaderBadge() {
  return <p className="simulated">Test mode · dummy reader, the card comes out blank</p>;
}
