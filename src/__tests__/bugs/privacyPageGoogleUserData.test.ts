/**
 * Scenario: on Android the backup screen signs in to Google and asks for one Drive scope. Google's
 * verification of that consent screen reads the privacy page for a section on Google user data,
 * and reads the home page as public only when it says no account is needed to read it.
 * Expected behaviour: the privacy page, in every language, names the scope the app requests, the
 * app's own Sign out label, the permissions page that revokes it, and the Limited Use statement
 * linked to the policy; the home page, in every language, says no account is needed, names the
 * Google Drive backup beside the privacy link, and carries no sign-in step.
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const privacy = fs.readFileSync(path.join(root, 'docs/privacy/index.html'), 'utf8');
const site = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
const authorization = fs.readFileSync(
  path.join(
    root,
    'modules/veloq-backup-exclusion/android/src/main/java/com/veloq/backupexclusion/GoogleDriveAuthorization.kt'
  ),
  'utf8'
);

const POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy';
const PERMISSIONS_URL = 'https://myaccount.google.com/permissions';
const LIMITED_USE =
  "Veloq's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements";

const plain = (html: string): string => html.replace(/<[^>]+>/g, '');

const requestedScope = authorization.match(/DRIVE_APPDATA_SCOPE = "([^"]+)"/)?.[1];

const tableOf = (html: string): Record<string, Record<string, string>> => {
  const start = html.indexOf('const translations = {');
  const end = html.indexOf('\n      };', start);
  return new Function(
    `return ${html.slice(start + 'const translations = '.length, end + '\n      }'.length)};`
  )();
};

const privacyTables = tableOf(privacy);
const siteTables = tableOf(site);

const markupText = (html: string, key: string): string => {
  const m = html.match(
    new RegExp(`data-i18n="${key.replace(/\./g, '\\.')}"[^>]*>([\\s\\S]*?)</(?:li|p|h2)>`)
  );
  if (!m) throw new Error(`no markup for ${key}`);
  return m[1].replace(/\s+/g, ' ').trim();
};

// The app locale whose backup screen each privacy page language describes.
const PRIVACY_APP_LOCALE: Record<string, string> = { en: 'en-GB', es: 'es', fr: 'fr' };

const appBackup = (locale: string): { carrierGoogleDriveSignOut: string } =>
  JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', `${locale}.json`), 'utf8')).backup;

const appLoginButton = (locale: string): string =>
  JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', `${locale}.json`), 'utf8')).login
    .loginWithIntervals;

const googleSection = (t: Record<string, string>): string =>
  Object.entries(t)
    .filter(([key]) => key.startsWith('googleData.'))
    .map(([, value]) => value)
    .join('\n');

describe('privacy page Google user data section', () => {
  it('reads the scope the app requests', () => {
    expect(requestedScope).toMatch(/^https:\/\/www\.googleapis\.com\/auth\/drive\.appdata$/);
  });

  it('has the section in the markup, with the scope and the Limited Use statement', () => {
    expect(privacy).toContain('<h2 data-i18n="googleData.title"');
    expect(markupText(privacy, 'googleData.scope')).toContain(requestedScope);
    expect(plain(markupText(privacy, 'googleData.limitedUse'))).toContain(LIMITED_USE);
    expect(privacy).toContain(`href="${POLICY_URL}"`);
  });

  it('reads the three languages', () => {
    expect(Object.keys(privacyTables).sort()).toEqual(Object.keys(PRIVACY_APP_LOCALE).sort());
  });

  it.each(Object.keys(PRIVACY_APP_LOCALE))(
    'the %s section names the scope, the Sign out label, the permissions page and the policy',
    (lang) => {
      const section = googleSection(privacyTables[lang]);
      expect(section).toContain(requestedScope);
      expect(section).toContain(appBackup(PRIVACY_APP_LOCALE[lang]).carrierGoogleDriveSignOut);
      expect(section).toContain(PERMISSIONS_URL);
      expect(privacyTables[lang]['googleData.limitedUse']).toContain(`href="${POLICY_URL}"`);
      expect(privacyTables[lang]['googleData.limitedUse']).toMatch(/Limited Use/);
    }
  );

  it('carries the English statement word for word in the English table', () => {
    expect(plain(privacyTables.en['googleData.limitedUse'])).toContain(LIMITED_USE);
  });

  it.each(Object.keys(PRIVACY_APP_LOCALE))(
    'the %s table carries every key the markup sets',
    (lang) => {
      const keys = [...privacy.matchAll(/data-i18n="(googleData\.[^"]+)"/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(privacyTables[lang][key]).toBeTruthy();
    }
  );
});

// The app locale whose login strings each website language would show. The site's Portuguese is
// Brazilian.
const SITE_APP_LOCALE: Record<string, string> = {
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

describe('home page reads as public', () => {
  it('reads every language the switcher offers', () => {
    expect(Object.keys(siteTables).sort()).toEqual(Object.keys(SITE_APP_LOCALE).sort());
  });

  it('the markup names the Drive backup beside the privacy link under Getting Started', () => {
    const steps = site.slice(
      site.indexOf('<section class="getting-started">'),
      site.indexOf('</main>')
    );
    expect(steps).toContain('data-i18n="getStarted.backup"');
    expect(markupText(site, 'getStarted.backup')).toContain('Google Drive');
    expect(markupText(site, 'getStarted.backup')).toContain('href="https://veloq.fit/privacy"');
  });

  it('the Getting Started text says no account is needed', () => {
    expect(markupText(site, 'getStarted.subtitle')).toMatch(/no account/i);
  });

  it.each(Object.keys(SITE_APP_LOCALE))(
    'the %s table names the Drive backup with the privacy link and has no sign-in step',
    (lang) => {
      const t = siteTables[lang];
      expect(t['getStarted.backup']).toContain('Google Drive');
      expect(t['getStarted.backup']).toContain('href="https://veloq.fit/privacy"');
      const loginButton = appLoginButton(SITE_APP_LOCALE[lang]);
      for (const [key, value] of Object.entries(t)) {
        if (key.startsWith('getStarted.')) expect(value).not.toContain(loginButton);
      }
    }
  );

  it('the markup has no sign-in step', () => {
    const steps = site.slice(
      site.indexOf('<section class="getting-started">'),
      site.indexOf('</main>')
    );
    expect(steps).not.toContain(appLoginButton('en-GB'));
  });
});
