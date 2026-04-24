import { buildStrengthBalancePairs, buildStrengthProgression } from '@/lib/strength/analysis';
import type { MuscleVolume, StrengthProgressPoint } from '@/types';

function makeMuscle(slug: string, weightedSets: number): MuscleVolume {
  return {
    slug,
    primarySets: Math.floor(weightedSets),
    secondarySets: 0,
    weightedSets,
    totalReps: 0,
    totalWeightKg: 0,
    exerciseNames: [],
  };
}

function makePoint(label: string, weightedSets: number): StrengthProgressPoint {
  return {
    label,
    startTs: 0,
    endTs: 0,
    weightedSets,
    activityCount: 1,
  };
}

describe('buildStrengthBalancePairs', () => {
  it('flags a large antagonist gap as imbalanced', () => {
    const pairs = buildStrengthBalancePairs([
      makeMuscle('quadriceps', 10),
      makeMuscle('hamstring', 4),
      makeMuscle('chest', 6),
      makeMuscle('upper-back', 6),
    ]);

    expect(pairs[0].id).toBe('quads_hamstrings');
    expect(pairs[0].status).toBe('imbalanced');
    expect(pairs[0].dominantLabel).toBe('Quadriceps');
    expect(pairs[0].ratio).toBe(2.5);
  });

  it('flags a pair with one active side as one-sided', () => {
    const pairs = buildStrengthBalancePairs([
      makeMuscle('chest', 5),
      makeMuscle('biceps', 4),
      makeMuscle('triceps', 4),
    ]);

    const chestBack = pairs.find((pair) => pair.id === 'chest_back');
    expect(chestBack!.status).toBe('one-sided');
    expect(chestBack!.ratio).toBe(Infinity);
  });

  it('keeps matched pairs balanced', () => {
    const pairs = buildStrengthBalancePairs([
      makeMuscle('biceps', 4),
      makeMuscle('triceps', 4),
      makeMuscle('quadriceps', 5),
      makeMuscle('hamstring', 5),
    ]);

    const armPair = pairs.find((pair) => pair.id === 'biceps_triceps');
    expect(armPair!.status).toBe('balanced');
    expect(armPair!.dominantLabel).toBeNull();
  });

  it('marks low-signal pairs as insufficient', () => {
    const pairs = buildStrengthBalancePairs([
      makeMuscle('quadriceps', 1),
      makeMuscle('hamstring', 1),
    ]);
    const lowerBody = pairs.find((pair) => pair.id === 'quads_hamstrings');
    expect(lowerBody!.status).toBe('insufficient');
  });
});

describe('buildStrengthProgression', () => {
  it('detects upward recent averages', () => {
    const progression = buildStrengthProgression('quadriceps', [
      makePoint('-3w', 4),
      makePoint('-2w', 5),
      makePoint('-1w', 8),
      makePoint('This wk', 9),
    ]);

    expect(progression.trend).toBe('up');
    expect(progression.changePct).toBeCloseTo(88.9, 1);
    expect(progression.recentAverage).toBe(8.5);
  });

  it('detects downward recent averages', () => {
    const progression = buildStrengthProgression('chest', [
      makePoint('-3w', 8),
      makePoint('-2w', 8),
      makePoint('-1w', 4),
      makePoint('This wk', 4),
    ]);

    expect(progression.trend).toBe('down');
    expect(progression.changePct).toBe(-50);
  });

  it('treats similar averages as flat', () => {
    const progression = buildStrengthProgression('upper-back', [
      makePoint('-3w', 4),
      makePoint('-2w', 5),
      makePoint('-1w', 4),
      makePoint('This wk', 5),
    ]);

    expect(progression.trend).toBe('flat');
    expect(progression.changePct).toBe(0);
  });

  it('treats a quiet baseline followed by recent work as up without a percentage', () => {
    const progression = buildStrengthProgression('hamstring', [
      makePoint('-3w', 0),
      makePoint('-2w', 0),
      makePoint('-1w', 3),
      makePoint('This wk', 5),
    ]);

    expect(progression.trend).toBe('up');
    expect(progression.changePct).toBeNull();
    expect(progression.peakWeightedSets).toBe(5);
  });
});
