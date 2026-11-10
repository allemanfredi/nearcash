/**
 * The screens of a sale in progress, driven by what the controller reports
 * (SessionView.stage): pay, a short "deposit received" animation when the
 * money arrives, then the banknote being made, then the result.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { SessionView, Stage } from '@nearcash/kiosk-api';
import { depositReceivedAnimation } from '../animations/deposit-received.ts';
import { LottiePlayer } from '../components/LottiePlayer.tsx';
import { QrCode } from '../components/QrCode.tsx';
import { Screen } from '../components/Screen.tsx';
import { formatCountdown, shortAddress, useSecondsLeft } from '../hooks.ts';
import { DummyReaderBadge, SimulatedBadge } from './ChooseScreens.tsx';

/** Stages that mean the payment has arrived. */
const PAID_STAGES: ReadonlySet<Stage> = new Set(['preparing', 'certifying', 'writing', 'dispensing', 'dispensed']);
/** How long the finished "deposit received" mark stays before the next screen. */
const DEPOSIT_HOLD_MS = 900;
/** In case the animation never reports its end (it failed to load): move on after this. */
const DEPOSIT_MAX_MS = 5_000;

export function SaleScreen({
  session,
  dummyReader,
  onCancel,
  onSimulatePayment,
  onFinish,
}: {
  session: SessionView;
  /** The printed dummy reader is in (Setup.dummyReader): nothing is issued, the card comes out blank. */
  dummyReader: boolean;
  onCancel: () => Promise<void>;
  onSimulatePayment: () => Promise<void>;
  onFinish: () => Promise<void>;
}) {
  const celebrating = useDepositCelebration(session.stage);
  if (celebrating.active) return <DepositReceivedScreen session={session} onDone={celebrating.end} />;

  switch (session.stage) {
    case 'awaiting_payment':
      return <PayScreen session={session} dummyReader={dummyReader} onCancel={onCancel} onSimulatePayment={onSimulatePayment} />;
    case 'preparing':
    case 'certifying':
    case 'writing':
    case 'dispensing':
      return <IssuingScreen session={session} dummyReader={dummyReader} />;
    default:
      return <ResultScreen session={session} dummyReader={dummyReader} onFinish={onFinish} />;
  }
}

/**
 * True from the moment the stage leaves "awaiting_payment" for a paid stage
 * until `end()` is called: the customer sees the deposit arrive. A page
 * reloaded in the middle of a sale (already paid) doesn't replay it.
 */
function useDepositCelebration(stage: Stage): { active: boolean; end: () => void } {
  const previous = useRef(stage);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (previous.current === 'awaiting_payment' && PAID_STAGES.has(stage)) setActive(true);
    previous.current = stage;
  }, [stage]);

  // A safety net: never stay on the animation.
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setActive(false), DEPOSIT_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  // Stable, so the screen's hold timer isn't restarted by every poll.
  const end = useCallback(() => setActive(false), []);
  return { active, end };
}

// ---------------------------------------------------------------- pay

function PayScreen({
  session,
  dummyReader,
  onCancel,
  onSimulatePayment,
}: {
  session: SessionView;
  dummyReader: boolean;
  onCancel: () => Promise<void>;
  onSimulatePayment: () => Promise<void>;
}) {
  const { payment } = session;
  const secondsLeft = useSecondsLeft(payment.deadline);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  if (confirmingCancel) {
    return (
      <Screen
        title="Cancel this purchase?"
        lead="Only cancel if you haven’t sent anything. Money sent to a cancelled purchase doesn’t become a banknote."
        actions={
          <>
            <button type="button" className="button button--primary" onClick={() => setConfirmingCancel(false)}>
              Keep waiting
            </button>
            <button type="button" className="button button--danger" disabled={busy} onClick={() => run(onCancel)}>
              Cancel purchase
            </button>
          </>
        }
      />
    );
  }

  // Only the QR code of the deposit address: the customer scans it with the
  // phone they pay from. The amount is in the title, to type in the wallet.
  return (
    <Screen
      title={
        <>
          Send <em>{payment.amount}</em> {payment.token}
        </>
      }
      lead={`On ${payment.network}. Scan the code with the wallet you pay from.`}
      onCancel={() => setConfirmingCancel(true)}
      actions={
        payment.simulated ? (
          <button type="button" className="button button--primary" disabled={busy} onClick={() => run(onSimulatePayment)}>
            Simulate the payment
          </button>
        ) : undefined
      }
    >
      {payment.simulated && <SimulatedBadge />}
      {dummyReader && <DummyReaderBadge />}
      <div className="pay">
        <QrCode text={payment.depositAddress} label={`Deposit address on ${payment.network}`} />
      </div>
      <p className="waiting">
        <span className="waiting__dot" aria-hidden="true" />
        Waiting for your payment · <span className={secondsLeft < 120 ? 'is-late' : ''}>{formatCountdown(secondsLeft)}</span> left
      </p>
      <p className="note">
        Only {payment.token} on {payment.network}, exactly this amount.{' '}
        {payment.refundTo
          ? `A refund goes to ${shortAddress(payment.refundTo)}.`
          : 'Pay from your own wallet, not an exchange: a refund goes back to the address that paid (amounts smaller than the network fee aren’t returned).'}
      </p>
    </Screen>
  );
}

// ---------------------------------------------------------------- deposit received

function DepositReceivedScreen({ session, onDone }: { session: SessionView; onDone: () => void }) {
  // Hold the finished mark a moment, then move on.
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(onDone, DEPOSIT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [finished, onDone]);

  return (
    <Screen
      title={
        <>
          Deposit <em>received.</em>
        </>
      }
      lead={`${session.payment.amount} ${session.payment.token} arrived. Your ${session.banknote} banknote is next.`}
    >
      <div className="deposit">
        <LottiePlayer animation={depositReceivedAnimation} label="Deposit received" onComplete={() => setFinished(true)} />
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------- issuing

const ISSUING_STEPS: { stage: Stage; label: string }[] = [
  { stage: 'preparing', label: 'Taking a blank note from the cassette' },
  { stage: 'certifying', label: 'Funding it and having NEAR MPC certify it' },
  { stage: 'writing', label: 'Writing the certificate and your PIN' },
  { stage: 'dispensing', label: 'Handing it over' },
];

/** With the dummy reader nothing is issued: the ATM only loads a blank card and hands it over. */
const DUMMY_READER_STEPS: { stage: Stage; label: string }[] = [
  { stage: 'dispensing', label: 'Loading a blank card and handing it over (dummy reader: nothing is written)' },
];

function IssuingScreen({ session, dummyReader }: { session: SessionView; dummyReader: boolean }) {
  const steps = dummyReader ? DUMMY_READER_STEPS : ISSUING_STEPS;
  const current = steps.findIndex((step) => step.stage === session.stage);
  return (
    <Screen
      title={
        <>
          Payment received. <em>{dummyReader ? 'Handing out a blank card.' : 'Printing your banknote.'}</em>
        </>
      }
      lead={`${session.banknote}. This takes a few seconds.`}
    >
      <ol className="progress">
        {steps.map((step, index) => (
          <li
            key={step.stage}
            className={`progress__step ${index < current ? 'is-done' : index === current ? 'is-current' : ''}`}
          >
            <span className="progress__mark" aria-hidden="true" />
            {step.label}
          </li>
        ))}
      </ol>
    </Screen>
  );
}

// ---------------------------------------------------------------- result

/** After this long on a result screen, the ATM goes back to the start by itself. */
const RESULT_TIMEOUT_MS = 45_000;

function ResultScreen({
  session,
  dummyReader,
  onFinish,
}: {
  session: SessionView;
  dummyReader: boolean;
  onFinish: () => Promise<void>;
}) {
  // Back to the start by itself if the customer just walks away.
  useEffect(() => {
    const timer = window.setTimeout(() => void onFinish(), RESULT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [onFinish]);

  const { title, lead, tone } = resultText(session, dummyReader);
  return (
    <Screen
      title={title}
      lead={lead}
      actions={
        <button type="button" className="button button--primary" onClick={() => void onFinish()}>
          {session.stage === 'dispensed' ? 'Done' : 'Start over'}
        </button>
      }
    >
      <div className={`result result--${tone}`}>
        <span className="result__mark" aria-hidden="true" />
        {session.stage === 'dispensed' && !dummyReader ? (
          <p className="result__value">{session.banknote}</p>
        ) : (
          <p className="result__reference">
            Reference <strong>{session.reference}</strong>
          </p>
        )}
      </div>
    </Screen>
  );
}

function resultText(
  session: SessionView,
  dummyReader: boolean,
): { title: ReactNode; lead: string; tone: 'good' | 'neutral' | 'bad' } {
  switch (session.stage) {
    case 'dispensed':
      // The dummy reader wrote nothing: a blank card, not a banknote. The sale stays paid at the bank.
      if (dummyReader) {
        return {
          title: (
            <>
              Take the <em>card.</em>
            </>
          ),
          lead: session.payment.simulated
            ? 'Test mode: the dummy reader wrote nothing on it, and the payment was simulated.'
            : 'Test mode: the dummy reader wrote nothing on it. Your payment stays with the bank: show this reference to the operator for a refund.',
          tone: 'good',
        };
      }
      return {
        title: (
          <>
            Take your <em>banknote.</em>
          </>
        ),
        lead: 'Keep your PIN to yourself until you hand the banknote on. Any phone with the NearCash app can check it, even offline.',
        tone: 'good',
      };
    case 'expired':
      return {
        title: 'Time’s up',
        lead: `No payment arrived in time. If you sent money after the deadline, it goes back to ${refundDestination(session)}.`,
        tone: 'neutral',
      };
    case 'refunded':
      return {
        title: 'Payment refunded',
        lead: `The payment couldn’t be completed, so your money goes back to ${refundDestination(session)}.`,
        tone: 'neutral',
      };
    case 'cancelled':
      return { title: 'Purchase cancelled', lead: 'You can start again whenever you like.', tone: 'neutral' };
    default:
      return {
        title: 'Something went wrong',
        lead: 'No banknote came out. Show this reference to the operator: they can see what happened to your payment.',
        tone: 'bad',
      };
  }
}

/** Where a refund of this sale goes, in words. */
function refundDestination(session: SessionView): string {
  return session.payment.refundTo ? 'the refund address you gave' : 'the address it was sent from';
}
