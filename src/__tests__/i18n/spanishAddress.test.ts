/**
 * Scenario: `es-ES.json` was written in the second person plural, `vuestro`
 * and `Tocad`, while `es` and `es-419` use `tú`. The app speaks to one person,
 * and in Spain one person is `tú`, so the plural reads as a machine
 * translation's idea of Peninsular Spanish rather than a register anyone chose.
 *
 * Expected behaviour: every Spanish bundle addresses one reader. The regional
 * differences that remain are vocabulary, `teselas` against `mosaicos`, which
 * are real choices and are not what this guards.
 */
import es from '@/i18n/locales/es.json';
import esES from '@/i18n/locales/es-ES.json';
import es419 from '@/i18n/locales/es-419.json';

/**
 * The plural forms that actually appear in a UI string: the possessive, the
 * pronoun, the clitic, the -áis/-éis conjugations, and the plural imperatives
 * the file uses. Nouns ending in -ad and -id are not verbs, so the imperatives
 * are listed rather than matched by their ending.
 */
const IMPERATIVES = [
  'tocad',
  'pulsad',
  'completad',
  'introducid',
  'intentad',
  'mantened',
  'revisad',
  'usad',
  'verificad',
  'iniciad',
  'escanead',
  'deslizad',
  'comprobad',
  'pegad',
  'cread',
  'obtened',
  'desconectad',
  'volved',
  'recibid',
  'esperad',
  'elegid',
  'desactivad',
  'activad',
  'arrastrad',
  'visualizad',
  'seguid',
  'monitorizad',
  'ajustad',
  'recortad',
  'cambiad',
  'exportad',
  'restaurad',
  'guardad',
  'añadid',
  'seleccionad',
  'abrid',
  'cerrad',
  'configurad',
  'conectad',
  'actualizad',
  'descargad',
];

// JavaScript's `\b` is keyed on `[A-Za-z0-9_]`, so it finds a boundary inside
// `años` and `os` matches there. The boundary has to be spelt out over the
// Spanish alphabet or the guard fires on half the file.
const LETTER = 'a-zA-ZáéíóúüñÁÉÍÓÚÜÑ';
const WORD = (body: string) => `(?<![${LETTER}])(?:${body})(?![${LETTER}])`;

const PLURAL = new RegExp(
  [
    WORD(IMPERATIVES.join('|')),
    WORD(`vuestr[${LETTER}]*`),
    WORD('vosotros'),
    WORD('os'),
    WORD(`[${LETTER}]+(?:áis|éis)`),
  ].join('|'),
  'i'
);

function flatten(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, [...path, k])
  );
}

function pluralEntries(bundle: unknown): string[] {
  return flatten(bundle)
    .filter(([, value]) => PLURAL.test(value))
    .map(([key, value]) => `${key}: ${value}`);
}

describe('Spanish addresses one reader', () => {
  it.each([
    ['es', es],
    ['es-ES', esES],
    ['es-419', es419],
  ])('%s uses tú rather than vosotros', (_locale, bundle) => {
    expect(pluralEntries(bundle)).toEqual([]);
  });

  it('catches a plural form, so an inert pattern fails rather than passes', () => {
    expect(pluralEntries({ a: 'Tocad en cualquier lugar para cerrar' })).toHaveLength(1);
    expect(pluralEntries({ a: 'Vuestra forma física (CTL)' })).toHaveLength(1);
    expect(pluralEntries({ a: '¿Podéis verlo?' })).toHaveLength(1);
  });

  it('leaves a noun that merely ends in -ad or -id alone', () => {
    expect(pluralEntries({ a: 'Actividad, velocidad, intensidad y privacidad' })).toEqual([]);
  });
});
