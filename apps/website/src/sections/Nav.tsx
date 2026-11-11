/** Sticky top bar: the wordmark and in-page links. */
const LINKS = [
  { href: '#problem', label: 'The problem' },
  { href: '#off-switch', label: 'Demo' },
  { href: '#how', label: 'How it works' },
  { href: '#near', label: 'Built on NEAR' },
  { href: '#business', label: 'Business' },
  { href: '#faq', label: 'FAQ' },
];

export function Nav() {
  return (
    <header className="nav">
      <div className="container nav__inner">
        <a className="wordmark" href="#top" aria-label="NearCash, back to top">
          <img src="./favicon.svg" alt="" width={26} height={26} />
          <span>NearCash</span>
        </a>
        <nav aria-label="Sections">
          <ul className="nav__links">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
