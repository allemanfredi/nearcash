/**
 * Every factual claim on the site links to where it comes from.
 * `label` is the publisher as readers know it ("Reuters", "Cloudflare").
 */
export interface Source {
  label: string;
  url: string;
}
