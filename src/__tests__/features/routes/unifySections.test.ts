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

const engineRow = (over: Partial<FrequentSection> = {}): FrequentSection => ({
  id: 'custom_1',
  sectionType: 'custom',
  name: 'The climb',
  sportType: 'Ride',
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
  sportType: 'Ride',
  polyline: [{ lat: 46.2, lng: 7.3 }],
  distanceMeters: 3000,
  activityIds: ['a1', 'a2'],
  visitCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const unify = (engineSections: FrequentSection[], customSections: Section[] = []) =>
  unifySections({ engineSections, customSections, includeCustom: true });

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

  it('takes a section the engine has not seen from the custom store', () => {
    const fresh = storeRow({ id: 'custom_new', name: 'Just made' });

    const ids = unify([engineRow()], [storeRow(), fresh]).map((s) => s.id);

    expect(ids).toEqual(['custom_1', 'custom_new']);
  });

  it('reads a prefixed id as custom even when the engine calls it auto', () => {
    const [section] = unify([engineRow({ sectionType: 'auto' })]);

    expect(section.sectionType).toBe('custom');
  });

  it('drops the custom store entirely when custom sections are excluded', () => {
    const result = unifySections({
      engineSections: [engineRow({ id: 'auto_1', sectionType: 'auto' })],
      customSections: [storeRow()],
      includeCustom: false,
    });

    expect(result.map((s) => s.id)).toEqual(['auto_1']);
  });

  it('puts custom before auto and hidden last', () => {
    const result = unify([
      engineRow({ id: 'auto_1', sectionType: 'auto' }),
      engineRow({ id: 'custom_1' }),
      engineRow({ id: 'auto_2', sectionType: 'auto', disabled: true }),
      engineRow({ id: 'custom_2', supersededBy: 'auto_1' }),
    ]);

    // Hidden last, and custom before auto inside each group.
    expect(result.map((s) => s.id)).toEqual(['custom_1', 'auto_1', 'custom_2', 'auto_2']);
  });

  it('keeps the engine order within a group, which is what nearby relies on', () => {
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
