/**
 * Scenario: an insight sheet's "How was this calculated?" ends in a link to the
 * data the card was computed from. Until it, the sheet's one such link read a
 * list of source activities no generator filled, so no sheet linked to a row.
 *
 * Expected behaviour: every category, as its generator emits it, names a
 * target that resolves to a screen, preferring what the card's graphic
 * pictures: a record's section opens with the record's effort highlighted, and
 * a summary across sections opens its top-ranked section.
 */

import { insightDataTarget, viewInDetailTarget } from '@/features/insights/lib/dataLink';
import type { Insight, InsightCategory } from '@/features/insights/types';
import { routeFilesFor } from '../__shared__/appRoutes';
import { insightCategories } from '../__shared__/insightCategories';
import { oneOfEach } from '../__shared__/insightsOfEveryKind';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

describe('the data an insight was computed from', () => {
  const cards = oneOfEach(t);

  it('builds a card in every category', () => {
    const built = new Set(cards.map((card) => card.category));
    expect([...built].sort()).toEqual([...insightCategories()].sort());
  });

  it.each(insightCategories() as InsightCategory[])(
    'a %s card links to a screen that exists',
    (category) => {
      for (const card of cards.filter((c) => c.category === category)) {
        const target = insightDataTarget(card);
        expect(target).not.toBeNull();
        expect(routeFilesFor(target as string)).not.toEqual([]);
      }
    }
  );

  it('opens a record on its section with the record effort highlighted', () => {
    const record = cards.find((card) => card.category === 'section_pr') as Insight;
    expect(insightDataTarget(record)).toBe('/section/ridge?activityId=ridge-3');
  });

  it('opens a summary across sections on its top-ranked section', () => {
    const trend = cards.find((card) => card.category === 'section_trend') as Insight;
    expect(insightDataTarget(trend)).toBe('/section/causeway');
  });

  it('opens a fitness card on the window it compared', () => {
    const fitness = cards.find((card) => card.category === 'fitness_milestone') as Insight;
    expect(insightDataTarget(fitness)).toMatch(/^\/fitness\?/);
  });

  it('names nothing for a card that carries no data', () => {
    const bare = { ...cards[0], navigationTarget: undefined, supportingData: undefined };
    expect(insightDataTarget(bare)).toBeNull();
  });
});

describe('View in detail', () => {
  const base = {
    id: 'x',
    category: 'section_pr',
    priority: 1,
    title: 'x',
    icon: 'x',
    iconTone: 'info',
    timestamp: 0,
    isNew: false,
  } as Insight;
  const pictured = (target: string) =>
    ({ kind: 'timeline', series: [], target }) as NonNullable<Insight['supportingData']>['history'];

  it('is dropped when the data link opens the same screen', () => {
    expect(viewInDetailTarget({ ...base, navigationTarget: '/section/quarry' })).toBeNull();
  });

  it('is dropped when the data link opens the same screen at one effort', () => {
    const insight = {
      ...base,
      navigationTarget: '/section/quarry',
      supportingData: { history: pictured('/section/quarry?activityId=ride-2') },
    } as Insight;
    expect(viewInDetailTarget(insight)).toBeNull();
  });

  it('stays when it opens a screen the data link does not', () => {
    const insight = {
      ...base,
      navigationTarget: '/fitness',
      supportingData: { history: pictured('/section/quarry') },
    } as Insight;
    expect(viewInDetailTarget(insight)).toBe('/fitness');
  });

  it('is absent for a card with nowhere to go', () => {
    expect(viewInDetailTarget(base)).toBeNull();
  });
});
