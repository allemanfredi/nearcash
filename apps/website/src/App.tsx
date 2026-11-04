import { Advice } from './sections/Advice.tsx';
import { Atm } from './sections/Atm.tsx';
import { Closing } from './sections/Closing.tsx';
import { Faq } from './sections/Faq.tsx';
import { Hero } from './sections/Hero.tsx';
import { HowItWorks } from './sections/HowItWorks.tsx';
import { Incidents } from './sections/Incidents.tsx';
import { Nav } from './sections/Nav.tsx';
import { OffSwitch } from './sections/OffSwitch.tsx';
import { Problem } from './sections/Problem.tsx';
import { Security } from './sections/Security.tsx';
import { TheCheck } from './sections/TheCheck.tsx';
import { Trust } from './sections/Trust.tsx';

/**
 * One page, told in order: the problem (servers are off switches), the
 * evidence, what central banks advise, a demo, then how NearCash works,
 * why it holds, and whom it trusts.
 */
export function App() {
  return (
    <>
      <a className="skip-link" href="#problem">
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Incidents />
        <Advice />
        <OffSwitch />
        <HowItWorks />
        <TheCheck />
        <Security />
        <Trust />
        <Atm />
        <Faq />
      </main>
      <Closing />
    </>
  );
}
