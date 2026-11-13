/**
 * Scenario: the connect page follows the browser's languages, lets the athlete
 * pick any locale the app ships, and keeps the pick for the next visit.
 *
 * Expected behaviour: a kept tag wins over the browser's list; a kept tag with
 * no chunk is ignored; choosing a language loads its chunk once, switches the
 * running instance and stores the tag.
 */

import { SUPPORTED_LOCALES } from '../../i18n/types';
import {
  LANGUAGE_NAMES,
  changeLanguage,
  startI18n,
  type LocaleEnv,
} from '../../../web/connect/i18n';

const CHUNKS = Object.fromEntries(SUPPORTED_LOCALES.map((tag) => [tag, `locales/${tag}.json`]));

function environment(languages: string[], kept: string | null) {
  const fetched: string[] = [];
  const stored: string[] = [];
  const env: LocaleEnv = {
    languages,
    chunks: CHUNKS,
    fetchJson: async (path) => {
      fetched.push(path);
      const tag = path.replace('locales/', '').replace('.json', '');
      return { connectPage: { title: `title in ${tag}` } } as never;
    },
    setLanguage: () => undefined,
    stored: () => kept,
    store: (tag) => stored.push(tag),
  };
  return { env, fetched, stored };
}

describe('connect page language', () => {
  it('starts in a kept choice over the browser list', async () => {
    const { env } = environment(['fr-FR'], 'ja');
    expect((await startI18n(env)).locale).toBe('ja');
  });

  it('ignores a kept tag the page has no chunk for', async () => {
    const { env } = environment(['fr-FR'], 'xx');
    expect((await startI18n(env)).locale).toBe('fr');
  });

  it('follows the browser when nothing is kept', async () => {
    const { env } = environment(['de-CH'], null);
    expect((await startI18n(env)).locale).toBe('de-CH');
  });

  it('switches the running page, fetches a chunk once and keeps the tag', async () => {
    const { env, fetched, stored } = environment(['en-GB'], null);
    const { i18n } = await startI18n(env);
    await changeLanguage(env, i18n, 'pl');
    expect(i18n.t('connectPage.title')).toBe('title in pl');
    await changeLanguage(env, i18n, 'en-GB');
    await changeLanguage(env, i18n, 'pl');
    expect(fetched.filter((path) => path.includes('pl'))).toHaveLength(1);
    expect(stored).toEqual(['pl', 'en-GB', 'pl']);
  });

  it('refuses a tag with no chunk and leaves the language and storage alone', async () => {
    const { env, stored } = environment(['en-GB'], null);
    const { i18n } = await startI18n(env);
    await expect(changeLanguage(env, i18n, 'xx')).rejects.toThrow('no chunk');
    expect(i18n.language).toBe('en-GB');
    expect(stored).toEqual([]);
  });

  it('names every locale the app ships, and no other', () => {
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });
});
