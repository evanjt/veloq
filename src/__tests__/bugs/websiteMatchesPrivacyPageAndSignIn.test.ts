/**
 * Scenario: the website links to both stores, and the privacy page beside it names the server
 * that stores push registrations. The app opens on the intervals.icu sign-in, with the API key
 * as the alternative.
 * Expected behaviour: the website makes no privacy claim the privacy page contradicts, and its
 * Getting Started names the app's own sign-in button, in every language, before the API key.
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

// The app locale whose login strings each website language shows. The site's Portuguese is Brazilian.
const APP_LOCALE: Record<string, string> = {
  en: 'en-GB',
  de: 'de-DE',
  nl: 'nl',
  fr: 'fr',
  it: 'it',
  es: 'es',
  pt: 'pt-BR',
  pl: 'pl',
  da: 'da',
  ja: 'ja',
  zh: 'zh-Hans',
};

const appLogin = (locale: string): { loginWithIntervals: string; useApiKey: string } =>
  JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', `${locale}.json`), 'utf8')).login;

const markupText = (key: string): string => {
  const m = site.match(new RegExp(`data-i18n="${key.replace(/\./g, '\\.')}"[^>]*>([\\s\\S]*?)</`));
  if (!m) throw new Error(`no markup for ${key}`);
  return m[1].replace(/\s+/g, ' ').trim();
};

const languages = Object.keys(translations);

describe('website privacy claims', () => {
  it('reads every language the switcher offers', () => {
    expect(languages.sort()).toEqual(Object.keys(APP_LOCALE).sort());
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

  it('says the developer never receives the data and names what the athlete turns on', () => {
    for (const text of [
      markupText('features.privacy.desc'),
      translations.en['features.privacy.desc'],
    ]) {
      expect(text).toMatch(/developer never receives/i);
      expect(text).toMatch(/push notifications/i);
      expect(text).toMatch(/backups/i);
    }
  });

  it.each(languages)('the %s table carries the same keys as English', (lang) => {
    expect(Object.keys(translations[lang]).sort()).toEqual(Object.keys(translations.en).sort());
  });
});

describe('website Getting Started', () => {
  it('the markup names the sign-in button, then the API key as the alternative', () => {
    const { loginWithIntervals, useApiKey } = appLogin('en-GB');
    expect(markupText('getStarted.step2.title')).toBe(loginWithIntervals);
    expect(markupText('getStarted.step1.title')).not.toMatch(/API/);
    expect(markupText('getStarted.step2.desc')).toContain(useApiKey);
  });

  it.each(languages)('the %s steps name the sign-in button before the API key', (lang) => {
    const { loginWithIntervals, useApiKey } = appLogin(APP_LOCALE[lang]);
    const t = translations[lang];
    expect(t['getStarted.step2.title']).toBe(loginWithIntervals);
    expect(`${t['getStarted.step1.title']} ${t['getStarted.step1.desc']}`).not.toMatch(/API/);
    expect(t['getStarted.step2.desc']).toContain(loginWithIntervals);
    expect(t['getStarted.step2.desc']).toContain(useApiKey);
    expect(t['getStarted.step2.desc'].indexOf(loginWithIntervals)).toBeLessThan(
      t['getStarted.step2.desc'].indexOf(useApiKey)
    );
  });
});
