import { Alert } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the athlete taps the activity that is already a section's reference.
 * Expected behaviour: the prompt offers a reset when the section carries a
 * reference the athlete set, and offers to set it otherwise. The answer comes
 * from the section the screen already holds, with no engine read on the tap.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: jest.fn(), renameSection: jest.fn() }),
}));

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false }),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const NO_EXCLUSIONS: string[] = [];

function sectionWith(isUserDefined: boolean): FrequentSection {
  return {
    id: 's1',
    sectionType: 'auto',
    sportTypes: ['Ride'],
    polyline: [],
    distanceMeters: 1200,
    activityIds: ['a1', 'a2'],
    visitCount: 3,
    createdAt: '2026-01-01T00:00:00Z',
    representativeActivityId: 'a1',
    isUserDefined,
  };
}

async function tapReference(isUserDefined: boolean, activityId: string) {
  const getSectionReferenceInfo = jest.fn(() => ({ isUserDefined: false }));
  mockedGetEngine.mockReturnValue({ getSectionReferenceInfo } as never);
  const section = sectionWith(isUserDefined);
  const hook = await renderHook(() =>
    useSectionActions({
      id: 's1',
      isCustomId: false,
      section,
      isSectionDisabled: false,
      onSectionRefresh: jest.fn(),
      sectionRefreshKey: 0,
      preComputedExcludedActivityIds: NO_EXCLUSIONS,
    })
  );
  hook.result.current.handleSetAsReference(activityId);
  return { getSectionReferenceInfo, title: (Alert.alert as jest.Mock).mock.calls[0]?.[0] };
}

describe('tapping the activity that is already the reference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('offers a reset when the section carries a reference the athlete set', async () => {
    const { title, getSectionReferenceInfo } = await tapReference(true, 'a1');

    expect(title).toBe('sections.resetReference');
    expect(getSectionReferenceInfo).not.toHaveBeenCalled();
  });

  it("offers to set it when the reference is the detector's own", async () => {
    const { title, getSectionReferenceInfo } = await tapReference(false, 'a1');

    expect(title).toBe('sections.setAsReference');
    expect(getSectionReferenceInfo).not.toHaveBeenCalled();
  });

  it("offers to set a different activity even when the reference is the athlete's", async () => {
    const { title } = await tapReference(true, 'a2');

    expect(title).toBe('sections.setAsReference');
  });
});
