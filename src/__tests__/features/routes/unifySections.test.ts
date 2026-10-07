/**
 * Scenario: a custom section exists both in the custom store and as an engine
 * row, which is every custom section the engine has seen.
 *
 * Expected behaviour: the engine row wins, so the section keeps its rank
 * scores, class and elevation. Taking the custom store's nine fields first
 * sorted every custom section last and rendered no elevation.
 */
import { unifySections } from '@/features/routes/lib/unifySections';
import type { FrequentSection, Section } from '@/features/routes/types';

jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));

const engineRow = (over: Partial<FrequentSection> = {}): FrequentSection => ({
  id: 'custom_1',
  sectionType: 'custom',
  name: 'The climb',
  sportTypes: ['Ride'],
  polyline: [{ lat: 46.2, lng: 7.3 }],
  distanceMeters: 3000,
  activityIds: ['a1', 'a2'],
  visitCount: 2,
  rankScore: 0.82,
  sportRankScore: 0.71,
  elevationGainM: 240,
  isUserDefined: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const storeRow = (over: Partial<Section> = {}): Section => ({
  id: 'custom_1',
  sectionType: 'custom',
  name: 'The climb',
  sportTypes: ['Ride'],
  polyline: [{ lat: 46.2, lng: 7.3 }],
  distanceMeters: 3000,
  activityIds: ['a1', 'a2'],
  visitCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const unify = (engineSections: FrequentSection[], _customStore: Section[] = []) =>
  unifySections({ engineSections });

describe('unifySections', () => {
  it('keeps the rank scores and elevation the engine row carries', () => {
    const [section] = unify([engineRow()], [storeRow()]);

    expect(section.rankScore).toBe(0.82);
    expect(section.sportRankScore).toBe(0.71);
    expect(section.elevationGainM).toBe(240);
    expect(section.isUserDefined).toBe(true);
  });

  it('names the section once, whichever row it came from', () => {
    expect(unify([engineRow()], [storeRow()])).toHaveLength(1);
  });

  it('renders no custom section the engine page left out', () => {
    const offPage = [
      storeRow({ id: 'custom_2', name: 'Park loop' }),
      storeRow({ id: 'custom_3', name: 'Harbour sprint' }),
    ];

    const ids = unify([engineRow({ id: 'auto_41', sectionType: 'auto' })], offPage).map(
      (s) => s.id
    );

    expect(ids).toEqual(['auto_41']);
  });

  it('renders nothing for an empty engine page, whatever the custom store holds', () => {
    expect(unify([], [storeRow()])).toEqual([]);
  });

  it('uses the engine type when a section id has a custom prefix', () => {
    const [section] = unify([engineRow({ sectionType: 'auto' })]);

    expect(section.sectionType).toBe('auto');
  });

  it('keeps a custom section whose id has no custom prefix', () => {
    const [section] = unify([engineRow({ id: 'foreign-id', sectionType: 'custom' })]);

    expect(section.sectionType).toBe('custom');
  });

  it("regroups nothing, because the order it was given is the query's answer", () => {
    const result = unify([
      engineRow({ id: 'auto_1', sectionType: 'auto' }),
      engineRow({ id: 'custom_1' }),
      engineRow({ id: 'auto_2', sectionType: 'auto', disabled: true }),
      engineRow({ id: 'custom_2', supersededBy: 'auto_1' }),
    ]);

    expect(result.map((s) => s.id)).toEqual(['auto_1', 'custom_1', 'auto_2', 'custom_2']);
  });

  it('keeps the engine order, which is every sort and not just nearby', () => {
    const result = unify([
      engineRow({ id: 'auto_2', sectionType: 'auto' }),
      engineRow({ id: 'auto_1', sectionType: 'auto' }),
      engineRow({ id: 'auto_3', sectionType: 'auto' }),
    ]);

    expect(result.map((s) => s.id)).toEqual(['auto_2', 'auto_1', 'auto_3']);
  });

  it("keeps the name the engine row carries rather than the store's", () => {
    const [section] = unify([engineRow({ name: 'Renamed in the app' })], [storeRow()]);

    expect(section.name).toBe('Renamed in the app');
  });
});

describe('a section the engine sends without a name', () => {
  it('stays unnamed rather than being described from its terrain', () => {
    const [section] = unify([
      engineRow({ id: 'auto_1', sectionType: 'auto', name: undefined, klass: 'climb' }),
    ]);

    expect(section.name ?? '').toBe('');
  });
});
