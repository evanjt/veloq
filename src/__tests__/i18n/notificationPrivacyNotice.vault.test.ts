/**
 * The notification privacy notice is the consent given before a push token
 * leaves the device. It says the athlete ID and the token are kept on the
 * server, so it must not also claim that no personal data is kept: an
 * identifier stored to route a push is personal data.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

/** Each language's form of the claim, so a locale that has the notice cannot carry it. */
const NO_PERSONAL_DATA = [
  /no personal data/i,
  /ingen personlige data/i,
  /kei persönlichi date/i,
  /keine persönlichen daten/i,
  /no se almacenan datos personales/i,
  /aucune donnée personnelle/i,
  /nessun dato personale/i,
  /個人データは保存されません/,
  /geen persoonlijke gegevens/i,
  /żadne dane osobowe/i,
  /nenhum dado pessoal/i,
  /不存储个人数据/,
];

function briefOf(locale: string): string {
  const notifications = resolvedLocale(locale).notifications as unknown as {
    privacy: { brief: string };
  };
  return notifications.privacy.brief;
}

describe('notification privacy notice', () => {
  it.each(locales)('%s does not claim that no personal data is stored', (locale) => {
    const brief = briefOf(locale);
    expect(brief).toBeTruthy();
    for (const claim of NO_PERSONAL_DATA) {
      expect(brief).not.toMatch(claim);
    }
  });
});
