import { resolvedLocale } from '../i18n/resolvedLocale';
import { buildStrengthBalancePairs as build } from '@/features/strength/lib/analysis';
import type { EngineBalancePair } from '@/features/strength/types';

const en = resolvedLocale('en-AU');

const names = en.strength as unknown as Record<string, Record<string, string>>;
const t = (key: string) => {
  const [, group, name] = key.match(/^strength\.(\w+)\.(\w+)$/) ?? [];
  return names[group][name];
};
const buildStrengthBalancePairs = (pairs: EngineBalancePair[]) => build(pairs, t);

function enginePair(
  id: string,
  leftSlug: string,
  rightSlug: string,
  left: number,
  right: number,
  status: EngineBalancePair['status'],
  ratio: number | null = null
): EngineBalancePair {
  return {
    id,
    leftSlug,
    rightSlug,
    leftWeightedSets: left,
    rightWeightedSets: right,
    dominantSlug: left === right ? null : left > right ? leftSlug : rightSlug,
    ratio,
    status,
  };
}

/**
 * Scenario: the verdict and the volumes behind it come from the engine, which
 * is where the sets are aggregated. What is left here is the copy and the order
 * the rows are read in.
 */
describe('buildStrengthBalancePairs', () => {
  it('names the pair and both sides from the slugs the engine sent', () => {
    const [pair] = buildStrengthBalancePairs([
      enginePair('quads_hamstrings', 'quadriceps', 'hamstring', 10, 4, 'imbalanced', 2.5),
    ]);

    expect(pair.label).toBe('Quads vs Hamstrings');
    expect(pair.leftLabel).toBe('Quadriceps');
    expect(pair.rightLabel).toBe('Hamstrings');
    expect(pair.dominantLabel).toBe('Quadriceps');
    expect(pair.ratio).toBe(2.5);
  });

  it('reads the worst pair first, and the wider gap first within a verdict', () => {
    const pairs = buildStrengthBalancePairs([
      enginePair('quads_hamstrings', 'quadriceps', 'hamstring', 6, 3, 'imbalanced', 2),
      enginePair('chest_back', 'chest', 'upper-back', 5, 0, 'one-sided'),
      enginePair('biceps_triceps', 'biceps', 'triceps', 8, 2, 'imbalanced', 4),
    ]);

    expect(pairs.map((pair) => pair.id)).toEqual([
      'chest_back',
      'biceps_triceps',
      'quads_hamstrings',
    ]);
  });

  it('leaves an even pair without a dominant name', () => {
    const [pair] = buildStrengthBalancePairs([
      enginePair('biceps_triceps', 'biceps', 'triceps', 4, 4, 'balanced', 1),
    ]);

    expect(pair.dominantLabel).toBeNull();
  });

  it('falls back to the slug for a pair it has no copy for', () => {
    const [pair] = buildStrengthBalancePairs([
      enginePair('calves_shins', 'calves', 'shins', 4, 4, 'balanced', 1),
    ]);

    expect(pair.label).toBe('calves_shins');
    expect(pair.rightLabel).toBe('shins');
  });
});
