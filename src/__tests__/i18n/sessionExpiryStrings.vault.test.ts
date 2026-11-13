/**
 * The signed-out notice ships five strings. Every locale needs all of them,
 * the athlete line has to keep its placeholder, and none of it may sit there
 * in English. The event line names only the event, so a translation carrying
 * the old "please sign in again" tail would say it twice.
 *
 * There is one event line because there is one signal, a 401, and it cannot
 * tell an expiry from another device taking the token. A locale that
 * says either would be claiming something the server never said.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function loginOf(locale: string): Record<string, string> {
  return resolvedLocale(locale).login as Record<string, string>;
}

describe('session expiry strings', () => {
  describe.each(locales)('%s', (locale) => {
    const login = loginOf(locale);

    it('keeps the athlete placeholder', () => {
      expect(login.sessionRestoreAthlete).toContain('{{athleteId}}');
    });

    it('leaves the sign-in instruction to the restore line', () => {
      expect(login.sessionSignedOut).not.toContain(login.sessionRestore);
    });

    it('claims no expiry and no revocation', () => {
      expect(login.sessionSignedOut.toLowerCase()).not.toMatch(/expir|revok/);
      expect(login.sessionKeyRejected.toLowerCase()).not.toMatch(/expir|revok/);
    });

    it('names the key in the key line', () => {
      expect(login.sessionKeyRejected.toLowerCase()).toMatch(
        /api|kľúč|nøgle|schlüssel|clé|clave|chiave|sleutel|klucz|chave|キー|密钥/
      );
    });
  });
});
