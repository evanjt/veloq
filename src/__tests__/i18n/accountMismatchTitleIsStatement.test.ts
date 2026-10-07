/**
 * Scenario: the account mismatch prompt is titled with a question about
 * replacing the library, which reads as the choice its button makes.
 *
 * Expected behaviour: in every locale the title states that the library on the
 * device belongs to another account, and asks nothing.
 */
import { resolvedLocale } from './resolvedLocale';
import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

function title(locale: string): string {
  const bundle = resolvedLocale(locale);
  return bundle.backup.deviceLibraryDifferentAccount;
}

describe('backup.deviceLibraryDifferentAccount', () => {
  it.each(locales)('%s states ownership and asks no question', (locale) => {
    expect(title(locale)).not.toMatch(/[?？]/);
  });

  it('de-CH says the library belongs to another account', () => {
    expect(title('de-CH')).toBe('D Bibliothek uf dem Grät ghört zu emene andere Konto');
  });
});
