/**
 * Scenario: the website links to both stores, and the privacy page beside it names the server
 * that stores push registrations.
 * Expected behaviour: the website makes no privacy claim the privacy page contradicts, in every
 * language.
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const site = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
const privacy = fs.readFileSync(path.join(root, 'docs/privacy/index.html'), 'utf8');

const tableStart = site.indexOf('const translations = {');
const tableEnd = site.indexOf('\n      };', tableStart);
const translations: Record<string, Record<string, string>> = new Function(
  `return ${site.slice(tableStart + 'const translations = '.length, tableEnd + '\n      }'.length)};`
)();

const markupText = (key: string): string => {
  const m = site.match(new RegExp(`data-i18n="${key.replace(/\./g, '\\.')}"[^>]*>([\\s\\S]*?)</`));
  if (!m) throw new Error(`no markup for ${key}`);
  return m[1].replace(/\s+/g, ' ').trim();
};

const languages = Object.keys(translations);

describe('website privacy claims', () => {
  it('reads every language the switcher offers', () => {
    expect(languages.sort()).toEqual([
      'da',
      'de',
      'en',
      'es',
      'fr',
      'it',
      'ja',
      'nl',
      'pl',
      'pt',
      'zh',
    ]);
  });

  it('the privacy page names the server that stores push registrations', () => {
    expect(privacy).toContain('auth.veloq.fit');
  });

  it.each([/no servers/i, /never leaves your (phone|device)/i])(
    'the markup and the English table do not claim %s',
    (claim) => {
      expect(site.slice(0, tableStart)).not.toMatch(claim);
      expect(Object.values(translations.en).join('\n')).not.toMatch(claim);
    }
  );

  it('names what push notifications keep on the server, as the privacy page does', () => {
    for (const text of [
      markupText('features.privacy.desc'),
      translations.en['features.privacy.desc'],
    ]) {
      expect(text).toMatch(/push notifications/i);
      expect(text).toMatch(/athlete ID/);
      expect(text).toMatch(/30 days/);
    }
    expect(privacy).toMatch(/athlete ID and an Expo push token \(30-day TTL\)/);
  });

  it('says notifications stay off until the athlete turns them on', () => {
    for (const text of [
      markupText('features.notifications.desc'),
      translations.en['features.notifications.desc'],
    ]) {
      expect(text).toMatch(/off until you turn (it|them) on/i);
    }
  });

  it.each(languages)('the %s table carries the same keys as English', (lang) => {
    expect(Object.keys(translations[lang]).sort()).toEqual(Object.keys(translations.en).sort());
  });

  it.each(languages)('the %s table carries no account or backup caveat under the hero', (lang) => {
    const keys = Object.keys(translations[lang]);
    expect(keys).not.toContain('hero.noAccount');
    expect(keys).not.toContain('hero.backup');
  });

  it('the hero markup has no caveat paragraphs and the frame has no notch bar', () => {
    expect(site).not.toMatch(/data-i18n="hero\.(noAccount|backup)"/);
    expect(site).not.toMatch(/phone-notch/);
  });
});
