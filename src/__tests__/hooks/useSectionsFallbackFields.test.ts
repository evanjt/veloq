import { renderHook } from '@testing-library/react-native';

import { useSections } from '@/features/routes/hooks/useSections';
import { sortBySignature } from '@/features/routes/lib/sectionRanking';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: the sections list is built by the hook itself whenever the batch
 * read has not landed, which is every first paint and every failure.
 * Expected behaviour: that list carries the same fields the batch one does, so
 * a section is named and ranked the same way whichever builder filled it.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => 0,
}));

jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ sections: [], isLoading: false, error: null }),
}));

jest.mock('@/shared/app/UnitPreferenceStore', () => ({
  resolveIsMetric: jest.fn(() => true),
}));

jest.mock('@/i18n', () => ({
  i18n: {
    t: jest.fn((key: string, opts?: Record<string, string>) => {
      if (key === 'sections.autoNameClimb') return `Climb ${opts?.distance} ${opts?.grade}`;
      if (key === 'sections.autoName') return `${opts?.sport} ${opts?.distance}`;
      return key;
    }),
  },
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sec-1',
    sectionType: 'auto',
    sportType: 'Ride',
    distanceMeters: 3200,
    visitCount: 4,
    activityCount: 3,
    confidence: 0.8,
    createdAt: '2026-01-01T00:00:00Z',
    isUserDefined: false,
    isLift: false,
    disabled: false,
    ...overrides,
  };
}

function engineReturning(summaries: Record<string, unknown>[]) {
  mockedGetEngine.mockReturnValue({
    getAllSectionsIncludingHidden: jest.fn(() => summaries),
  } as never);
}

describe('the list the hook builds when no batch read has landed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('names a classed climb from its terrain, not from sport and distance', () => {
    engineReturning([summary({ klass: 'climb', maxGradePercent: 6.1 })]);

    const { result } = renderHook(() => useSections());

    expect(result.current.sections[0]?.name).toBe('Climb 3.2 km 6.1%');
  });

  it('leaves a section that already has a name alone', () => {
    engineReturning([summary({ name: 'Old Mill', klass: 'climb', maxGradePercent: 6.1 })]);

    const { result } = renderHook(() => useSections());

    expect(result.current.sections[0]?.name).toBe('Old Mill');
  });

  it('falls back to sport and distance when the class carries no grade', () => {
    engineReturning([summary({ klass: 'climb' })]);

    const { result } = renderHook(() => useSections());

    expect(result.current.sections[0]?.name).toBe('Ride 3.2 km');
  });

  it('carries the ranks, so the interest sort has something to order by', () => {
    engineReturning([
      summary({ id: 'a', rankScore: 0.2, sportRankScore: 0.9 }),
      summary({ id: 'b', rankScore: 0.7, sportRankScore: 0.1 }),
    ]);

    const { result } = renderHook(() => useSections());

    expect(sortBySignature(result.current.sections, false).map((s) => s.id)).toEqual(['b', 'a']);
    expect(sortBySignature(result.current.sections, true).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('carries the elevation the batch path carries', () => {
    engineReturning([
      summary({ elevationGainM: 120, elevationLossM: 8, avgGradePercent: 3.4, klass: 'climb' }),
    ]);

    const [section] = renderHook(() => useSections()).result.current.sections;

    expect(section?.elevationGainM).toBe(120);
    expect(section?.elevationLossM).toBe(8);
    expect(section?.avgGradePercent).toBe(3.4);
    expect(section?.klass).toBe('climb');
  });
});
