/**
 * Every sibling sort in the sections list names what it sorts by, and the
 * athlete can check it by eye. "Signature" named nothing, so the sort reads as
 * a black box. The label is "Relevance", which is the engine's own word for the
 * score it reads, and the key has to agree with the copy in every locale.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const SECTIONS_LIST = path.join(__dirname, '../../features/routes/components/SectionsList.tsx');

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function routesOf(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).routes as Record<string, string>;
}

describe('sections list sort labels', () => {
  describe.each(locales)('%s', (locale) => {
    const routes = routesOf(locale);

    it('no longer defines sortSignature', () => {
      expect(routes.sortSignature).toBeUndefined();
    });
  });

  it('reads Relevance in every English locale', () => {
    for (const locale of ENGLISH_LOCALES) {
      expect(routesOf(locale).sortRelevance).toBe('Relevance');
    }
  });

  it('is the key the sections list asks for', () => {
    const source = fs.readFileSync(SECTIONS_LIST, 'utf-8');
    expect(source).toContain('routes.sortRelevance');
    expect(source).not.toContain('routes.sortSignature');
  });
});
