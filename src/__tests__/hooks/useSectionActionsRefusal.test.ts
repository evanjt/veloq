import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { getEngine } from '@/shared/native/engine';
import { goBack } from '@/shared/app/navigation';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the engine is open but refuses a section write (busy past its
 * timeout, an I/O error), and the delegate answers false.
 * Expected behaviour: the screen says the change was not made and shows the
 * state the engine still holds. A refused remove keeps the page open, a
 * refused exclude or include leaves the excluded set as it was, a refused
 * accept invalidates nothing. A failed exclusions read on mount leaves the
 * screen standing rather than throwing into the error boundary.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/navigation', () => ({
  goBack: jest.fn(),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

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

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const alertSpy = () => Alert.alert as unknown as jest.Mock;

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

// Hoisted so the exclusions effect does not re-fire on every render.
const EXCLUDED_A2: string[] = ['a2'];

interface MountOptions {
  isSectionDisabled?: boolean;
  preComputed?: string[];
}

async function mountWith(engine: Record<string, unknown>, options: MountOptions = {}) {
  mockedGetEngine.mockReturnValue(engine as never);
  const onSectionRefresh = jest.fn();
  const hook = await renderHook(() =>
    useSectionActions({
      id: 's1',
      isCustomId: false,
      section: SECTION,
      isSectionDisabled: options.isSectionDisabled ?? false,
      onSectionRefresh,
      sectionRefreshKey: 0,
      preComputedExcludedActivityIds: options.preComputed,
    })
  );
  return { hook, onSectionRefresh };
}

/** The title of the last alert raised, which is the failure report when one is shown. */
function lastAlertTitle(): string | undefined {
  const calls = alertSpy().mock.calls;
  return calls.length ? calls[calls.length - 1][0] : undefined;
}

describe('a section write the engine refuses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('keeps the page open and says so when the remove is refused', async () => {
    const disableSection = jest.fn(() => false);
    const { hook } = await mountWith({ disableSection }, { preComputed: EXCLUDED_A2 });

    await act(() => hook.result.current.handleToggleDisable());

    expect(disableSection).toHaveBeenCalledWith('s1');
    expect(goBack).not.toHaveBeenCalled();
    expect(alertSpy()).toHaveBeenCalledTimes(1);
    expect(lastAlertTitle()).toBe('sections.removeFailedTitle');
  });

  it('leaves the page when the remove is written', async () => {
    const disableSection = jest.fn(() => true);
    const { hook } = await mountWith({ disableSection }, { preComputed: EXCLUDED_A2 });

    await act(() => hook.result.current.handleToggleDisable());

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(alertSpy()).not.toHaveBeenCalled();
  });

  it('says so and does not refresh when the restore is refused', async () => {
    const enableSection = jest.fn(() => false);
    const { hook, onSectionRefresh } = await mountWith(
      { enableSection },
      { isSectionDisabled: true, preComputed: EXCLUDED_A2 }
    );

    await act(() => hook.result.current.handleToggleDisable());

    expect(enableSection).toHaveBeenCalledWith('s1');
    expect(lastAlertTitle()).toBe('sections.restoreFailedTitle');
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });

  it('does not add the ride to the excluded set when the exclude is refused', async () => {
    const excludeActivityFromSection = jest.fn(() => false);
    const { hook, onSectionRefresh } = await mountWith(
      { excludeActivityFromSection },
      { preComputed: EXCLUDED_A2 }
    );

    await act(() => hook.result.current.handleExcludeActivity('a1'));

    expect(excludeActivityFromSection).toHaveBeenCalledWith('s1', 'a1');
    expect([...hook.result.current.excludedActivityIds]).toEqual(['a2']);
    expect(lastAlertTitle()).toBe('sections.changeFailedTitle');
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });

  it('adds the ride to the excluded set when the exclude is written', async () => {
    const excludeActivityFromSection = jest.fn(() => true);
    const { hook, onSectionRefresh } = await mountWith(
      { excludeActivityFromSection },
      { preComputed: EXCLUDED_A2 }
    );

    await act(() => hook.result.current.handleExcludeActivity('a1'));

    expect([...hook.result.current.excludedActivityIds].sort()).toEqual(['a1', 'a2']);
    expect(alertSpy()).not.toHaveBeenCalled();
    expect(onSectionRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the ride in the excluded set when the include is refused', async () => {
    const includeActivityInSection = jest.fn(() => false);
    const { hook, onSectionRefresh } = await mountWith(
      { includeActivityInSection },
      { preComputed: EXCLUDED_A2 }
    );

    await act(() => hook.result.current.handleIncludeActivity('a2'));

    expect(includeActivityInSection).toHaveBeenCalledWith('s1', 'a2');
    expect([...hook.result.current.excludedActivityIds]).toEqual(['a2']);
    expect(lastAlertTitle()).toBe('sections.changeFailedTitle');
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });

  it('invalidates nothing when the accept is refused', async () => {
    const acceptSection = jest.fn(() => false);
    const { hook, onSectionRefresh } = await mountWith(
      { acceptSection },
      { preComputed: EXCLUDED_A2 }
    );

    await act(() => hook.result.current.handleAcceptSection());

    expect(acceptSection).toHaveBeenCalledWith('s1');
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(onSectionRefresh).not.toHaveBeenCalled();
    expect(lastAlertTitle()).toBe('sections.changeFailedTitle');
  });

  it('invalidates and refreshes when the accept is written', async () => {
    const acceptSection = jest.fn(() => true);
    const { hook, onSectionRefresh } = await mountWith(
      { acceptSection },
      { preComputed: EXCLUDED_A2 }
    );

    await act(() => hook.result.current.handleAcceptSection());

    expect(mockInvalidate).toHaveBeenCalled();
    expect(onSectionRefresh).toHaveBeenCalledTimes(1);
    expect(alertSpy()).not.toHaveBeenCalled();
  });

  it('renders with an empty excluded set when the exclusions read throws on mount', async () => {
    const getExcludedActivityIds = jest.fn(() => {
      throw new Error('database is locked');
    });

    const { hook } = await mountWith({ getExcludedActivityIds });

    expect(getExcludedActivityIds).toHaveBeenCalledWith('s1');
    expect(hook.result.current.excludedActivityIds.size).toBe(0);
  });

  it('takes the engine read when there is nothing precomputed and it answers', async () => {
    const getExcludedActivityIds = jest.fn(() => ['a1']);

    const { hook } = await mountWith({ getExcludedActivityIds });

    expect([...hook.result.current.excludedActivityIds]).toEqual(['a1']);
  });
});
