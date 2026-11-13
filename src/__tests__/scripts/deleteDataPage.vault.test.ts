/**
 * Scenario: the Play Data safety form links a delete-your-data page.
 * Expected behaviour: the page exists, leads with the steps, states the retention figures the
 * sign-in worker and the privacy declarations record hold, and is linked from the privacy page's
 * rights section and the footers of the site's pages, in English, Spanish and French.
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const worker = read('oauth-proxy/src/worker.ts');
const declarations = JSON.parse(read('config/fastlane/metadata/store-privacy-declarations.json'));

const pagePath = 'docs/delete-data/index.html';
const page = fs.existsSync(path.join(root, pagePath)) ? read(pagePath) : '';

type Lang = 'en' | 'es' | 'fr';
const LANGS: Lang[] = ['en', 'es', 'fr'];

function translationTables(): Record<Lang, Record<string, string>> {
  const m = page.match(/const translations = (\{[\s\S]*?\n {6}\});/);
  if (!m) throw new Error('the page carries no translations table');
  return new Function(`return ${m[1]}`)();
}

const constant = (name: string): number => {
  const m = worker.match(new RegExp(`const ${name} = ([0-9 *]+);`));
  if (!m) throw new Error(`worker has no ${name}`);
  return m[1].split('*').reduce((a, b) => a * Number(b.trim()), 1);
};

const days = constant('DEVICE_TOKEN_TTL_SECONDS') / 86400;
const stateMinutes = constant('STATE_TTL_SECONDS') / 60;
const rateSeconds = constant('RATE_LIMIT_WINDOW_SECONDS');
const webhookMinutes =
  Number(worker.match(/OAUTH_STATES\.put\(seen, "1", \{ expirationTtl: (\d+) \}/)?.[1]) / 60;

const serverHeld: { id: string; what: string; deletion: string[] }[] = declarations.serverHeld;
const what = (id: string) => serverHeld.find((s) => s.id === id)!.what;

describe('delete your data page', () => {
  it('exists and is titled for the athlete', () => {
    expect(page).toContain('Delete your Veloq data');
  });

  it('leads with the steps, then the server records, then what is not Veloq to delete', () => {
    const order = ['steps.title', 'server.title', 'elsewhere.title'].map((k) =>
      page.indexOf(`data-i18n="${k}"`)
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('names the removal route by email and the push record removal on sign-out', () => {
    expect(page).toContain('mailto:developer@veloq.fit');
    expect(page).toMatch(/sign out/i);
    expect(page).toMatch(/athlete id/i);
  });

  it.each(LANGS)('states the retention figures in %s', (lang) => {
    const t = translationTables()[lang];
    const server = t['server.content'];
    expect(server).toContain(String(days));
    expect(server).toContain(String(stateMinutes));
    expect(server).toContain(String(rateSeconds));
    expect(server).toContain(String(webhookMinutes));
  });

  it('holds the figures to the declarations record', () => {
    expect(serverHeld.find((s) => s.id === 'athleteId')!.deletion.join(' ')).toContain(
      `${days} days`
    );
    expect(what('oauthState')).toContain(`${stateMinutes} minutes`);
    expect(what('ipRateCounter')).toContain(`${rateSeconds} seconds`);
    expect(what('webhookEvent')).toContain(`${webhookMinutes} minutes`);
  });

  it.each(LANGS)('has every key in %s', (lang) => {
    const tables = translationTables();
    expect(Object.keys(tables[lang]).sort()).toEqual(Object.keys(tables.en).sort());
  });

  it.each(['docs/privacy/index.html', 'docs/terms/index.html', 'docs/index.html'])(
    'is linked from %s',
    (rel) => {
      expect(read(rel)).toContain('https://veloq.fit/delete-data');
    }
  );

  it('is linked from the privacy rights section in every language', () => {
    const privacy = read('docs/privacy/index.html');
    const rights = privacy.slice(privacy.indexOf('data-i18n="rights.title"'));
    expect(rights.slice(0, rights.indexOf('data-i18n="changes.title"'))).toContain('/delete-data');
    const count = (privacy.match(/"rights\.item2":[^\n]*\/delete-data/g) ?? []).length;
    expect(count).toBe(3);
  });
});
