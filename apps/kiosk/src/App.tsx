/**
 * The kiosk on the ATM's iPhone.
 *
 * Before paying, the customer makes three choices, kept here in the page:
 *   1. banknote  2. network and token (and, if they pay from an exchange,
 *   a refund address)  3. PIN
 * Then the controller takes over (POST /api/session) and the page only
 * shows what it reports, polling GET /api/session. Reloading the page in
 * the middle of a sale picks it up again.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SessionView, Setup } from '@nearcash/kiosk-api';
import { ApiError, api } from './api.ts';
import { Screen } from './components/Screen.tsx';
import { useIdleTimeout } from './hooks.ts';
import { AmountScreen, type Banknote, MethodScreen, type PaymentChoice } from './screens/ChooseScreens.tsx';
import { PinScreen } from './screens/PinScreen.tsx';
import { SaleScreen } from './screens/SaleScreens.tsx';

/** The choices made so far, before the sale exists. */
type Draft =
  | { step: 'amount' }
  // `choice`: what was picked before, when the customer came back from the PIN.
  | { step: 'method'; banknote: Banknote; choice?: PaymentChoice }
  | { step: 'pin'; banknote: Banknote; choice: PaymentChoice };

const START: Draft = { step: 'amount' };
const POLL_MS = 1_500;
/** A customer who walks away mid-choice: back to the start after this. */
const IDLE_MS = 60_000;
/** Out of service (e.g. no card reader): ask again this often, to come back by itself. */
const OUT_OF_SERVICE_RETRY_MS = 30_000;

export function App() {
  const [setup, setSetup] = useState<Setup | null>(null);
  /** undefined: not loaded yet; null: no sale in progress. */
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(START);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [unpaired, setUnpaired] = useState(false);

  /** Anything that fails with 401 means the screen isn't paired. */
  const handle = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) setUnpaired(true);
    else setOffline(true);
  }, []);

  // What's on sale (retried until the controller answers, and while out of service).
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = () =>
      api
        .setup()
        .then((value) => {
          if (cancelled) return;
          setSetup(value);
          setOffline(false);
          if (value.outOfService) timer = window.setTimeout(load, OUT_OF_SERVICE_RETRY_MS);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          handle(error);
          timer = window.setTimeout(load, 5_000);
        });
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [handle]);

  // The sale in progress, as the controller sees it.
  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      api
        .session()
        .then((value) => {
          if (cancelled) return;
          setSession(value);
          setOffline(false);
        })
        .catch((error: unknown) => !cancelled && handle(error));
    void poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [handle]);

  const reset = useCallback(() => {
    setDraft(START);
    setStartError(null);
  }, []);

  useIdleTimeout(IDLE_MS, !session && draft.step !== 'amount' && !starting, reset);

  const start = async (pin: string) => {
    if (draft.step !== 'pin') return;
    setStarting(true);
    setStartError(null);
    try {
      const { option, refundTo } = draft.choice;
      const view = await api.start({
        amount: draft.banknote.amount,
        paymentOptionId: option.id,
        ...(refundTo ? { refundTo } : {}),
        pin,
      });
      setSession(view);
      setDraft(START);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const finish = useCallback(async () => {
    try {
      await api.finish();
    } catch {
      // Already finished (e.g. by the timeout on another render): nothing to do.
    }
    setSession(null);
    reset();
  }, [reset]);

  if (unpaired) {
    return (
      <Screen
        title="This screen isn’t paired"
        lead="Operator: open this page once with the ATM’s kiosk key (…/#key=…)."
      />
    );
  }
  if (!setup || session === undefined) {
    return (
      <Screen
        title={offline ? 'Out of service' : 'Starting…'}
        lead={offline ? 'This ATM can’t reach its controller right now. Please try again later.' : undefined}
      />
    );
  }

  // No new sale while the ATM can't make banknotes (a sale already running is still shown).
  // The ATM server's reason goes underneath, small, for the operator: what to fix.
  if (setup.outOfService && !session) {
    return (
      <Screen
        title="Out of service"
        lead="This ATM can’t make banknotes right now. Please try again later."
      >
        <p className="note">Operator: {setup.outOfService}</p>
      </Screen>
    );
  }

  if (session) {
    return (
      <SaleScreen
        session={session}
        dummyReader={setup.dummyReader}
        onCancel={async () => setSession(await api.cancel())}
        onSimulatePayment={async () => setSession(await api.simulatePayment())}
        onFinish={finish}
      />
    );
  }

  switch (draft.step) {
    case 'amount':
      return <AmountScreen setup={setup} onChoose={(banknote) => setDraft({ step: 'method', banknote })} />;
    case 'method':
      return (
        <MethodScreen
          setup={setup}
          banknote={draft.banknote}
          initial={draft.choice}
          onChoose={(choice) => setDraft({ step: 'pin', banknote: draft.banknote, choice })}
          onBack={reset}
          onCancel={reset}
        />
      );
    case 'pin':
      return (
        <PinScreen
          busy={starting}
          error={startError}
          onPin={start}
          onBack={() => setDraft({ step: 'method', banknote: draft.banknote, choice: draft.choice })}
          onCancel={reset}
        />
      );
  }
}
