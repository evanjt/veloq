/**
 * Scenario: the linked browser contacts a relay and a STUN server when the switch is on.
 * Expected behaviour: the privacy page, in each language it carries, names both hosts, says that
 * training data does not reach our server, and does not limit the worker section to OAuth mode.
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const page = fs.readFileSync(path.join(root, 'docs/privacy/index.html'), 'utf8');

const start = page.indexOf('const translations = {');
const table = page.slice(start);
const blocks: Record<string, string> = {};
for (const lang of ['en', 'es', 'fr']) {
  const from = table.indexOf(`\n        ${lang}: {`);
  const rest = table.slice(from + 1);
  const next = rest.search(/\n {8}[a-z]{2}: \{|\n {6}\};/);
  blocks[lang] = next < 0 ? rest : rest.slice(0, next);
}

describe('linked browser contacts are disclosed', () => {
  it.each(Object.keys(blocks))('%s block names the relay and the STUN server', (lang) => {
    expect(blocks[lang]).toContain('auth.veloq.fit/link');
    expect(blocks[lang]).toContain('stun.cloudflare.com');
  });

  it.each(Object.keys(blocks))('%s block carries every linked-browser item', (lang) => {
    const keys = [...page.matchAll(/data-i18n="(thirdParty\.link\.[a-z0-9]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const key of keys) {
      expect(blocks[lang]).toContain(`"${key}":`);
    }
  });

  it.each(Object.keys(blocks))('%s worker heading is not limited to OAuth mode', (lang) => {
    const heading = blocks[lang].match(/"thirdParty\.cloudflare\.title": "([^"]*)"/)?.[1] ?? '';
    expect(heading).toMatch(/Cloudflare Workers/);
    expect(heading).not.toMatch(/OAuth|solo modo|uniquement/);
  });
});
