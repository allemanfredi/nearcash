import { useState } from 'react';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@nearcash/kiosk-api';
import { Keypad } from '../components/Keypad.tsx';
import { Screen } from '../components/Screen.tsx';
import { STEPS_BEFORE_PAYING } from './ChooseScreens.tsx';

/**
 * Step 3: the banknote's PIN, typed twice. It is chosen before paying so
 * the banknote can come out by itself as soon as the payment arrives.
 */
export function PinScreen({
  busy,
  error,
  onPin,
  onBack,
  onCancel,
}: {
  /** The quote is being made: keys are disabled. */
  busy: boolean;
  /** Why the last attempt to start the sale failed. */
  error: string | null;
  onPin: (pin: string) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const confirming = first !== null;

  const submit = () => {
    if (!confirming) {
      setFirst(value);
      setValue('');
      return;
    }
    if (value !== first) {
      setMismatch(true);
      setFirst(null);
      setValue('');
      return;
    }
    onPin(value);
  };

  return (
    <Screen
      title={confirming ? 'Enter the PIN again' : 'Choose a PIN'}
      lead={
        confirming
          ? 'To be sure it’s the one you meant.'
          : `${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits. You need it to redeem the banknote, and you tell it to whoever you give the banknote to.`
      }
      step={{ current: 3, total: STEPS_BEFORE_PAYING }}
      onBack={busy ? undefined : onBack}
      onCancel={busy ? undefined : onCancel}
      actions={
        <button
          type="button"
          className="button button--primary"
          onClick={submit}
          disabled={busy || value.length < PIN_MIN_LENGTH}
        >
          {busy ? 'Preparing your payment…' : confirming ? 'Confirm PIN' : 'Next'}
        </button>
      }
    >
      <fieldset className="pin" disabled={busy}>
        <Keypad
          value={value}
          maxLength={PIN_MAX_LENGTH}
          onChange={(next) => {
            setValue(next);
            setMismatch(false);
          }}
        />
      </fieldset>
      {mismatch && <p className="error">The two PINs didn’t match. Choose it again.</p>}
      {error && <p className="error">{error}</p>}
    </Screen>
  );
}
