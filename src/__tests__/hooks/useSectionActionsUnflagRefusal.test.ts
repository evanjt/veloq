import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the athlete confirms removing the lift flag and the engine refuses the write.
 * Expected behaviour: the screen says the change was not made, and nothing is invalidated or
 * refreshed. A written unflag invalidates the section queries and refreshes without a report.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/navigation', () => ({
  goBack: jest.fn(),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

jest.mock('@/shared/ui/dialog', () => ({
  ...jest.requireActual('@/shared/ui/dialog'),
  confirmAction: (options: { onConfirm: () => void }) => options.onConfirm(),
}));

const mockInvalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: jest.fn(), renameSection: jest.fn() }),
}));

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false }),
}));

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
};

const PRE_COMPUTED: string[] = [];

async function unflagWith(setSectionIsLift: jest.Mock) {
  (getEngine as jest.Mock).mockReturnValue({ setSectionIsLift });
  const onSectionRefresh = jest.fn();
  const hook = await renderHook(() =>
    useSectionActions({
      id: 's1',
      isCustomId: false,
      section: SECTION,
      isSectionDisabled: false,
      onSectionRefresh,
      sectionRefreshKey: 0,
      preComputedExcludedActivityIds: PRE_COMPUTED,
    })
  );
  await act(async () => hook.result.current.handleUnflagLift());
  return { onSectionRefresh };
}

describe('removing the lift flag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('says so and refreshes nothing when the engine refuses', async () => {
    const setSectionIsLift = jest.fn(() => false);
    const { onSectionRefresh } = await unflagWith(setSectionIsLift);

    expect(setSectionIsLift).toHaveBeenCalledWith('s1', false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });

  it('refreshes without a report when the engine writes it', async () => {
    const { onSectionRefresh } = await unflagWith(jest.fn(() => true));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(onSectionRefresh).toHaveBeenCalledTimes(1);
  });
});
