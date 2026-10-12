import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { getEngine } from '@/shared/native/engine';
import { goBack } from '@/shared/app/navigation';
import { showNotice } from '@/shared/ui/Notice';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the athlete removes a detected section from its page. Removal is reversible, so the
 * page does not ask first.
 * Expected behaviour: the section goes at once, the page closes and a notice offers Undo, which
 * restores it. A removal the engine refuses keeps the page open and says so instead of showing
 * the section as gone.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/navigation', () => ({
  goBack: jest.fn(),
}));

jest.mock('@/shared/ui/Notice', () => ({
  showNotice: jest.fn(() => 1),
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
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

// A fresh array here re-fires the hook's exclusions effect on every render.
const NO_EXCLUSIONS: string[] = [];

async function mountWith(engine: Record<string, unknown> | null) {
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

describe('removing a detected section from its page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('removes at once, closes the page and offers Undo', async () => {
    const disableSection = jest.fn(() => true);
    const enableSection = jest.fn(() => true);
    const hook = await mountWith({ disableSection, enableSection });

    await act(() => hook.result.current.handleToggleDisable());

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(disableSection).toHaveBeenCalledWith('s1');
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(mockedShowNotice).toHaveBeenCalledTimes(1);

    const { message, action } = mockedShowNotice.mock.calls[0][0];
    expect(message).toBe('sections.sectionRemoved');
    expect(action?.label).toBe('common.undo');
    await act(() => action?.onPress());
    expect(enableSection).toHaveBeenCalledWith('s1');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('keeps the page open and says so when the engine refuses', async () => {
    const disableSection = jest.fn(() => false);
    const hook = await mountWith({ disableSection, enableSection: jest.fn() });

    await act(() => hook.result.current.handleToggleDisable());

    expect(goBack).not.toHaveBeenCalled();
    expect(mockedShowNotice).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('sections.removeFailedTitle');
  });

  it('says so when Undo cannot restore the section', async () => {
    const enableSection = jest.fn(() => false);
    const hook = await mountWith({ disableSection: jest.fn(() => true), enableSection });

    await act(() => hook.result.current.handleToggleDisable());
    const { action } = mockedShowNotice.mock.calls[0][0];
    await act(() => action?.onPress());

    expect(enableSection).toHaveBeenCalledWith('s1');
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('sections.restoreFailedTitle');
  });

  it('removes nothing and closes nothing when the engine is not up', async () => {
    const hook = await mountWith(null);

    await act(() => hook.result.current.handleToggleDisable());

    expect(goBack).not.toHaveBeenCalled();
    expect(mockedShowNotice).not.toHaveBeenCalled();
  });
});
