/**
 * Scenario: the link's API reference is published with the site it documents. The connect build
 * writes the schema the reference links, and every page of the site reaches the reference from its
 * footer.
 * Expected behaviour: the connect build writes `schema.json` beside the page and in its versioned
 * directory, equal to the committed schema; every `veloq.fit` link in the reference resolves to a
 * file of the site once the connect build is in place; and each site page links the reference from
 * its footer.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const BUILD = join(REPO, 'scripts/build-connect-page.mjs');
const DOCS = join(REPO, 'docs');
const COMMITTED_SCHEMA = join(REPO, 'web/connect/schema.json');
const METHODS = join(REPO, 'web/connect/methods.json');
const HOST = 'https://veloq.fit/';
/** The site's pages that carry the footer, by their path in `docs/`. */
const PAGES = ['index.html', 'privacy/index.html', 'terms/index.html', 'delete-data/index.html'];

let site: string;

beforeAll(() => {
  site = mkdtempSync(join(tmpdir(), 'api-reference-site-'));
  cpSync(DOCS, site, { recursive: true });
  execFileSync('node', [BUILD, '--out', join(site, 'connect')], { stdio: 'pipe' });
}, 300_000);

afterAll(() => {
  if (site) rmSync(site, { recursive: true, force: true });
});

/**
 * The file of the site a `veloq.fit` URL names, a directory meaning its `index.html`, or null
 * when the URL leaves the site or names nothing there.
 */
function siteFile(url: URL): string | null {
  if (url.host !== 'veloq.fit') return null;
  const path = decodeURIComponent(url.pathname);
  const file = join(site, path);
  if (existsSync(file) && statSync(file).isFile()) return file;
  if (existsSync(join(file, 'index.html'))) return join(file, 'index.html');
  return null;
}

/** The `href` of each anchor in a page, resolved against the page's own address. */
function linksOf(pagePath: string): URL[] {
  const html = readFileSync(join(DOCS, pagePath), 'utf8');
  return [...html.matchAll(/href="([^"]*)"/g)].map(
    (match) => new URL(match[1], `${HOST}${pagePath}`)
  );
}

it('writes schema.json beside the page and in its versioned directory', () => {
  const { protocol } = JSON.parse(readFileSync(METHODS, 'utf8'));
  const committed = readFileSync(COMMITTED_SCHEMA);
  expect(readFileSync(join(site, 'connect/schema.json'))).toEqual(committed);
  expect(readFileSync(join(site, `connect/v${protocol}/schema.json`))).toEqual(committed);
}, 60_000);

it('resolves every veloq.fit link in the reference to a file of the site', () => {
  const missing = linksOf('api/index.html')
    .filter((url) => url.host === 'veloq.fit' && siteFile(url) === null)
    .map((url) => url.href);
  expect(missing).toEqual([]);
});

it('links the reference from the footer of every site page', () => {
  for (const page of PAGES) {
    const html = readFileSync(join(DOCS, page), 'utf8');
    const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
    const reference = [...footer.matchAll(/href="([^"]*)"/g)]
      .map((match) => new URL(match[1], `${HOST}${page}`))
      .filter((url) => siteFile(url) === join(site, 'api/index.html'));
    expect([page, reference.length]).toEqual([page, 1]);
  }
});
