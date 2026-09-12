import { act, renderHook } from '@testing-library/react-native';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the detector flags a section as lift ground and the athlete knows
 * it is not one.
 * Expected behaviour: the unflag reaches the engine as the durable intent
 * write, and the screen re-reads the section so the badge goes. A refusal
 * leaves the badge up rather than hiding a flag that is still set.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ removeSection: jest.fn(), renameSection: jest.fn() }),
}));

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false }),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportType: 'Ride',
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
  isLift: true,
};

// A fresh array here re-fires the hook's exclusions effect on every render,
// which sets a new Set and renders again, so it is hoisted.
const NO_EXCLUSIONS: string[] = [];

function mountWith(engine: Record<string, unknown> | null, onSectionRefresh = jest.fn()) {
  mockedGetEngine.mockReturnValue(engine as never);
  const hook = renderHook(() =>
    useSectionActions({
      id: 's1',
      isCustomId: false,
      section: SECTION,
      isSectionDisabled: false,
      onSectionRefresh,
      sectionRefreshKey: 0,
      preComputedExcludedActivityIds: NO_EXCLUSIONS,
    })
  );
  return { hook, onSectionRefresh };
}

describe('unflagging a section the detector called lift ground', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes the unflag through the engine and refreshes the section', () => {
    const setSectionIsLift = jest.fn(() => true);
    const { hook, onSectionRefresh } = mountWith({ setSectionIsLift });

    act(() => hook.result.current.handleUnflagLift());

    expect(setSectionIsLift).toHaveBeenCalledWith('s1', false);
    expect(onSectionRefresh).toHaveBeenCalled();
  });

  it('does not refresh when the engine is not up', () => {
    const { hook, onSectionRefresh } = mountWith(null);

    act(() => hook.result.current.handleUnflagLift());

    expect(onSectionRefresh).not.toHaveBeenCalled();
  });

  it('does not refresh when the engine refuses the write', () => {
    const setSectionIsLift = jest.fn(() => false);
    const { hook, onSectionRefresh } = mountWith({ setSectionIsLift });

    act(() => hook.result.current.handleUnflagLift());

    expect(setSectionIsLift).toHaveBeenCalledWith('s1', false);
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });
});
