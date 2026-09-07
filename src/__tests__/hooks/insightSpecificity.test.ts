/**
 * Scenario: proximal specificity is worth ten points and eleven of fifteen emit
 * sites asserted it as a constant triple. An assertion is a claim about copy,
 * and the copy can stop honouring it: a locale that drops the number, or a
 * title rewritten to lose the section name, leaves the claim standing.
 *
 * Expected behaviour: the number and the place are read off the strings the
 * athlete actually sees, so copy that loses them loses the points with them.
 */

import { specificityScore } from '@/features/insights/lib/rules';
import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import type { Insight } from '@/features/insights/types';

const { all3, any2 } = INSIGHTS_CONFIG.scoring.specificityBonus;

function insight(fields: Partial<Insight>): Insight {
  return {
    id: 'i',
    category: 'section_trend',
    priority: 2,
    title: '',
    icon: 'x',
    iconColor: '#000',
    timestamp: 0,
    isNew: false,
    confidence: null,
    ...fields,
  } as Insight;
}

// Two signals is where the score first moves: one alone is worth nothing.
const PLACE = { placeName: 'Sunday Climb' };

it('reads the number off the rendered copy, not off an assertion', () => {
  const withNumber = insight({ title: 'Sunday Climb 6 seconds faster', meta: PLACE });
  const withoutNumber = insight({ title: 'Sunday Climb getting faster', meta: PLACE });

  expect(specificityScore(withNumber)).toBe(any2);
  expect(specificityScore(withoutNumber)).toBe(0);
});

it('credits a place only when the place survives into the copy', () => {
  const named = insight({ title: 'Sunday Climb 6s faster', meta: PLACE });
  const dropped = insight({ title: 'A section is 6s faster', meta: PLACE });

  expect(specificityScore(named)).toBe(any2);
  expect(specificityScore(dropped)).toBe(0);
});

it('credits a date only when the insight is about a moment other than now', () => {
  const now = 1_700_000_000_000;
  const past = insight({
    title: 'Sunday Climb 6s faster',
    timestamp: now,
    meta: { placeName: 'Sunday Climb', sourceTimestamp: now - 3 * 86_400_000 },
  });
  const rightNow = insight({
    title: 'Sunday Climb 6s faster',
    timestamp: now,
    meta: { placeName: 'Sunday Climb', sourceTimestamp: now },
  });

  expect(specificityScore(past)).toBe(all3);
  expect(specificityScore(rightNow)).toBe(any2);
});

it('scores an insight that names nothing at zero', () => {
  expect(specificityScore(insight({ title: 'Keep going' }))).toBe(0);
});

it('reads the subtitle and the body, not the title alone', () => {
  const inSubtitle = insight({
    title: 'Sunday Climb getting faster',
    subtitle: '6 seconds off',
    meta: PLACE,
  });
  const inBody = insight({
    title: 'Sunday Climb getting faster',
    body: '6 seconds off',
    meta: PLACE,
  });

  expect(specificityScore(inSubtitle)).toBe(any2);
  expect(specificityScore(inBody)).toBe(any2);
});
