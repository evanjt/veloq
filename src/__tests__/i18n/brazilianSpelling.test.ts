/**
 * Scenario: `pt` is European Portuguese and `pt-BR` Brazilian, and the section
 * word is where the two part: `secção` in Portugal, `seção` in Brazil. A merge
 * once took the European lines back into `pt-BR`, and the engine stamps the
 * section word into every new section's stored name.
 *
 * Expected behaviour: `pt-BR` never spells the word the European way, nor in
 * the unaccented form it once carried, while `pt` keeps its own spelling.
 */
import pt from '@/i18n/locales/pt.json';
import ptBR from '@/i18n/locales/pt-BR.json';

function flatten(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, [...path, k])
  );
}

function europeanSectionWords(bundle: unknown): string[] {
  return flatten(bundle)
    .filter(([, value]) => /secç|seccao/i.test(value))
    .map(([key, value]) => `${key}: ${value}`);
}

describe('Brazilian Portuguese spelling', () => {
  it('pt-BR spells the section word the Brazilian way', () => {
    expect(europeanSectionWords(ptBR)).toEqual([]);
  });

  it('pt keeps the European spelling', () => {
    expect(europeanSectionWords(pt).length).toBeGreaterThan(0);
  });

  it('pt stamps the accented European section word into stored names', () => {
    expect(flatten(pt).find(([k]) => k.endsWith('sectionWord'))?.[1]).toBe('Secção');
  });
});
