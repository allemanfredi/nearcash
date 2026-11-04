import { useEffect, useRef, useState } from 'react';
import { Banknote } from '../components/Banknote.tsx';
import { Icon } from '../components/Icon.tsx';
import { Section } from '../components/Section.tsx';
import { usePrefersReducedMotion, wait } from '../hooks.ts';

/**
 * Interactive illustration: switch the servers off and compare a crypto app
 * with a NearCash banknote. Scripted, nothing here talks to a network.
 */

/** The servers behind a typical wallet app, in the order they fail. */
const APP_SERVERS = ['Wallet backend', 'RPC provider', 'Cloud region'];

/** What the phone checks on a NearCash card (see "The check" below). */
const CARD_CHECKS = ['In circulation', 'Certificate signed by NEAR MPC', 'Certificate matches this chip', 'Chip proves its key'];

type CheckState = 'idle' | 'checking' | 'valid';

export function OffSwitch() {
  const reducedMotion = usePrefersReducedMotion();
  const [offline, setOffline] = useState(false);
  /** How many of APP_SERVERS are down (they fail one after another). */
  const [serversDown, setServersDown] = useState(0);
  const [check, setCheck] = useState<CheckState>('idle');
  /** How many of CARD_CHECKS have passed in the current check. */
  const [checksPassed, setChecksPassed] = useState(0);

  // Each scripted sequence gets a number; a newer one makes older ones stop.
  const outageRun = useRef(0);
  const checkRun = useRef(0);
  useEffect(
    () => () => {
      outageRun.current++;
      checkRun.current++;
    },
    [],
  );

  const pace = (ms: number) => wait(reducedMotion ? 0 : ms);

  async function runCheck() {
    const run = ++checkRun.current;
    setCheck('checking');
    setChecksPassed(0);
    for (let i = 1; i <= CARD_CHECKS.length; i++) {
      await pace(320);
      if (run !== checkRun.current) return;
      setChecksPassed(i);
    }
    setCheck('valid');
  }

  async function toggle() {
    const run = ++outageRun.current;
    if (offline) {
      setOffline(false);
      setServersDown(0);
      return;
    }
    setOffline(true);
    for (let i = 1; i <= APP_SERVERS.length; i++) {
      await pace(420);
      if (run !== outageRun.current) return;
      setServersDown(i);
    }
    // Then show that the banknote doesn't care.
    await pace(300);
    if (run === outageRun.current) void runCheck();
  }

  const appBroken = serversDown > 0;
  const appDead = serversDown === APP_SERVERS.length;

  return (
    <Section
      id="off-switch"
      tone="ink"
      eyebrow="Try it"
      title={
        <>
          Pull the plug. <em>See what still works.</em>
        </>
      }
      lead="On the left, crypto in a typical wallet app. On the right, a NearCash banknote. Switch the servers off and watch both."
    >
      <div className="switchbar">
        <button
          type="button"
          role="switch"
          aria-checked={!offline}
          className={`toggle ${offline ? 'toggle--off' : ''}`}
          onClick={() => void toggle()}
        >
          <span className="toggle__track" aria-hidden="true">
            <span className="toggle__thumb" />
          </span>
          <span className="toggle__label">
            Servers: <strong>{offline ? 'offline' : 'online'}</strong>
          </span>
        </button>
        <p className="switchbar__hint">{offline ? 'Switch them back on' : 'Tap to switch every server off'}</p>
      </div>

      <div className="demo">
        {/* ---------------------------------------------------------- the app */}
        <article className={`demo__panel ${appDead ? 'demo__panel--dead' : ''}`} aria-live="polite">
          <header className="demo__header">
            <h3>Crypto in an app</h3>
            <span className={`status ${appBroken ? 'status--down' : 'status--up'}`}>
              {appBroken ? 'Can’t connect' : 'Connected'}
            </span>
          </header>

          <div className="mockapp">
            <p className="mockapp__label">Balance</p>
            <p className={`mockapp__balance ${appBroken ? 'mockapp__balance--gone' : ''}`}>
              {appBroken ? '— — —' : '1,240.00'}
              <small>USDC</small>
            </p>
            {appDead ? (
              <p className="mockapp__error" role="alert">
                <Icon name="cross" size={16} />
                Service unavailable (503). Please try again later.
              </p>
            ) : (
              <p className="mockapp__note">{appBroken ? 'Loading…' : 'Updated just now'}</p>
            )}
            <div className="mockapp__actions">
              <button type="button" disabled={appBroken} tabIndex={-1}>
                Send
              </button>
              <button type="button" disabled={appBroken} tabIndex={-1}>
                Receive
              </button>
            </div>
          </div>

          <ol className="minipath" aria-label="What the app depends on">
            {APP_SERVERS.map((server, index) => {
              const down = index < serversDown;
              return (
                <li key={server} className={down ? 'is-down' : 'is-up'}>
                  <Icon name={down ? 'cross' : 'server'} size={16} />
                  {server}
                </li>
              );
            })}
            <li className="is-up is-chain">
              <Icon name="chain" size={16} />
              Blockchain{offline ? ': still running' : ''}
            </li>
          </ol>

          <p className="demo__caption">
            {appDead
              ? 'The coins are still on-chain. The way to them is gone.'
              : 'Every tap goes through servers run by someone else.'}
          </p>
        </article>

        {/* ----------------------------------------------------- the banknote */}
        <article className="demo__panel demo__panel--note" aria-live="polite">
          <header className="demo__header">
            <h3>A NearCash banknote</h3>
            <span className="status status--up">Works offline</span>
          </header>

          <div className="demo__note">
            <Banknote amount="10" symbol="USDC" serial="NC 1E9B 7A40" className={check === 'checking' ? 'is-tapping' : ''} />
          </div>

          <ul className="checklist" aria-label="Offline checks">
            {CARD_CHECKS.map((label, index) => {
              const passed = index < checksPassed;
              return (
                <li key={label} className={passed ? 'is-passed' : ''}>
                  <Icon name={passed ? 'check' : 'nfc'} size={16} />
                  {label}
                </li>
              );
            })}
          </ul>

          <div className="demo__result">
            {check === 'valid' ? (
              <p className="result result--valid">
                <Icon name="check" size={18} />
                <strong>Valid banknote · 10 USDC</strong>
                <span>0 network requests</span>
              </p>
            ) : (
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void runCheck()}
                disabled={check === 'checking'}
              >
                <Icon name="nfc" size={18} />
                {check === 'checking' ? 'Checking over NFC…' : 'Tap the banknote on a phone'}
              </button>
            )}
          </div>

          <ol className="minipath" aria-label="What the banknote depends on">
            <li className="is-up">
              <Icon name="chip" size={16} />
              Banknote
            </li>
            <li className="is-up">
              <Icon name="nfc" size={16} />
              NFC
            </li>
            <li className="is-up">
              <Icon name="phone" size={16} />
              Phone
            </li>
          </ol>

          <p className="demo__caption">
            {check === 'valid' && offline
              ? 'Same answer with every server down.'
              : 'No server in between. Same answer online or offline.'}
          </p>
        </article>
      </div>
      <p className="footnote">Illustration. The checks are the real ones the NearCash app runs; the timings are not measured.</p>
    </Section>
  );
}
