import { Banknote } from '../components/Banknote.tsx';

export function Closing() {
  return (
    <>
      <section className="closing" aria-labelledby="closing-title">
        <div className="container closing__inner">
          <div>
            <h2 id="closing-title" className="closing__title">
              Money should keep working <em>when the network doesn’t.</em>
            </h2>
            <p className="closing__lead">
              NearCash is a banknote you can check with any phone, pass on without asking anyone, and
              redeem when you choose. No server needed in the middle.
            </p>
            <a className="button button--light" href="#top">
              Back to the top
            </a>
          </div>
          <Banknote amount="5" symbol="USDC" serial="NC 6C51 0F3D" className="closing__note" />
        </div>
      </section>

      <footer className="footer">
        <div className="container footer__inner">
          <span className="wordmark wordmark--small">
            <img src="./favicon.svg" alt="" width={20} height={20} />
            NearCash
          </span>
          <p>A hackathon prototype by Nektar Labs.</p>
          <p className="footer__note">This site makes no requests to third parties: no trackers, no external fonts.</p>
        </div>
      </footer>
    </>
  );
}
