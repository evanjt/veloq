import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { getEngine } from '@/shared/native/engine';
import { NOTICE_LONG_MS, showNotice } from '@/shared/ui/Notice';
import * as haptics from '@/shared/ui/haptics';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the athlete excludes an attempt from a section. Exclusion is reversible and runs
 * without a confirm, and the dot vanishes while excluded attempts are hidden.
 * Expected behaviour: a notice says the attempt was excluded and offers Undo, which includes it
 * again, and the destructive haptic fires. A refused exclusion shows no notice.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/navigation', () => ({
  goBack: jest.fn(),
}));

jest.mock('@/shared/ui/Notice', () => ({
  ...jest.requireActual('@/shared/ui/Notice'),
  showNotice: jest.fn(() => 1),
}));

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

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

const mockedGetEngine = jest.mocked(getEngine);
const mockedShowNotice = jest.mocked(showNotice);

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1', 'a2'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

// A fresh array here re-fires the hook's exclusions effect on every render.
const NO_EXCLUSIONS: string[] = [];

function mountWith(engine: Record<string, unknown>) {
  mockedGetEngine.mockReturnValue(engine as never);
  return renderHook(() =>
    useSectionActions({
      id: 's1',
      isCustomId: false,
      section: SECTION,
      isSectionDisabled: false,
      onSectionRefresh: jest.fn(),
      sectionRefreshKey: 0,
      preComputedExcludedActivityIds: NO_EXCLUSIONS,
    })
  );
}

describe('excluding an attempt from a section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('says the attempt was excluded and Undo includes it again', async () => {
    const excludeActivityFromSection = jest.fn(() => true);
    const includeActivityInSection = jest.fn(() => true);
    const hook = mountWith({ excludeActivityFromSection, includeActivityInSection });

    await act(() => hook.result.current.handleExcludeActivity('a2'));

    expect(excludeActivityFromSection).toHaveBeenCalledWith('s1', 'a2');
    expect(hook.result.current.excludedActivityIds.has('a2')).toBe(true);
    expect(haptics.medium).toHaveBeenCalledTimes(1);
    expect(mockedShowNotice).toHaveBeenCalledTimes(1);

    const { message, action, duration } = mockedShowNotice.mock.calls[0][0];
    expect(message).toBe('sections.attemptExcluded');
    expect(action?.label).toBe('common.undo');
    expect(duration).toBe(NOTICE_LONG_MS);

    await act(() => action?.onPress());
    expect(includeActivityInSection).toHaveBeenCalledWith('s1', 'a2');
    expect(hook.result.current.excludedActivityIds.has('a2')).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows no notice and fires no haptic when the engine refuses', async () => {
    const hook = mountWith({
      excludeActivityFromSection: jest.fn(() => false),
      includeActivityInSection: jest.fn(),
    });

    await act(() => hook.result.current.handleExcludeActivity('a2'));

    expect(mockedShowNotice).not.toHaveBeenCalled();
    expect(haptics.medium).not.toHaveBeenCalled();
    expect(hook.result.current.excludedActivityIds.has('a2')).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('says so when Undo cannot include the attempt again', async () => {
    const includeActivityInSection = jest.fn(() => false);
    const hook = mountWith({
      excludeActivityFromSection: jest.fn(() => true),
      includeActivityInSection,
    });

    await act(() => hook.result.current.handleExcludeActivity('a2'));
    const { action } = mockedShowNotice.mock.calls[0][0];
    await act(() => action?.onPress());

    expect(includeActivityInSection).toHaveBeenCalledWith('s1', 'a2');
    expect(hook.result.current.excludedActivityIds.has('a2')).toBe(true);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});
