/**
 * A numeric keypad for the PIN. The digits stay hidden (dots); the keys are
 * large enough for a public screen.
 */
export function Keypad({
  value,
  maxLength,
  onChange,
}: {
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  const press = (digit: string) => {
    if (value.length < maxLength) onChange(value + digit);
  };
  return (
    <div className="keypad">
      <div className="pin-dots" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: Math.max(4, value.length) }, (_, index) => (
          <span key={index} className={`pin-dot ${index < value.length ? 'is-filled' : ''}`} />
        ))}
      </div>
      <div className="keypad__grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button key={digit} type="button" className="key" onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" className="key key--quiet" onClick={() => onChange('')} disabled={value.length === 0}>
          Clear
        </button>
        <button type="button" className="key" onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="key key--quiet"
          onClick={() => onChange(value.slice(0, -1))}
          disabled={value.length === 0}
          aria-label="Delete last digit"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
