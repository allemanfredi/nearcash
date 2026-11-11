import { type ReactNode, useState } from 'react';
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

  // Both texts of each step are laid out, only the current one shows: the
  // title and the lead keep the same height on both steps, so the keypad
  // stays in the same place when the customer types the PIN again.
  const shown = confirming ? 1 : 0;
  return (
    <Screen
      title={<OneOf shown={shown} options={['Choose a PIN', 'Enter the PIN again']} />}
      lead={
        <OneOf
          shown={shown}
          options={[
            `${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits. You need it to redeem the banknote, and you tell it to whoever you give the banknote to.`,
            'To be sure it’s the one you meant.',
          ]}
        />
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

/**
 * Several texts stacked in the same spot, only `options[shown]` visible. The
 * spot is as tall as the longest text, whichever one shows.
 */
function OneOf({ options, shown }: { options: ReactNode[]; shown: number }) {
  return (
    <span className="one-of">
      {options.map((option, index) => (
        <span key={index} className="one-of__option" aria-hidden={index !== shown}>
          {option}
        </span>
      ))}
    </span>
  );
}
