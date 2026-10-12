import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the athlete sets or resets a section's reference, which re-matches
 * every ride against the new line.
 * Expected behaviour: the edit runs off the JS thread, so the confirm handler
 * returns while it runs, a second reference tap is refused until it ends, and
 * the outcome is handled once it settles.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

const mockInvalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: jest.fn(), renameSection: jest.fn() }),
}));
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false }),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const NO_EXCLUSIONS: string[] = [];
const ride = { activityId: 'a9', name: 'Harbour spin', date: 1_710_200_000 };

function sectionWith(isUserDefined: boolean): FrequentSection {
  return {
    id: 's1',
    sectionType: 'custom',
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

async function mountWith(edit: () => Promise<unknown[] | null>, isUserDefined = false) {
  const engine = { runSectionBoundsEdit: jest.fn(edit) };
  mockedGetEngine.mockReturnValue(engine as never);
  const onSectionRefresh = jest.fn();
  const section = sectionWith(isUserDefined);
  const hook = await renderHook(() =>
    useSectionActions({
      id: 's1',
      isCustomId: true,
      section,
      isSectionDisabled: false,
      onSectionRefresh,
      sectionRefreshKey: 0,
      preComputedExcludedActivityIds: NO_EXCLUSIONS,
    })
  );
  return { hook, engine, onSectionRefresh };
}

/** Tap the reference action and return the prompt's confirm handler. */
function confirmOf(tap: () => void): () => unknown {
  (Alert.alert as jest.Mock).mockClear();
  tap();
  const buttons = (Alert.alert as jest.Mock).mock.calls[0]?.[2] as
    | { onPress?: () => unknown }[]
    | undefined;
  (Alert.alert as jest.Mock).mockClear();
  return () => buttons?.[1]?.onPress?.();
}

function deferred() {
  let settle!: (value: unknown[] | null) => void;
  const promise = new Promise<unknown[] | null>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe('setting and resetting a section reference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns from the confirm while the edit runs and refuses a second reference tap', async () => {
    const { hook, engine, onSectionRefresh } = await mountWith(() => new Promise(() => {}));
    const confirm = confirmOf(() => hook.result.current.handleSetAsReference('a2'));
    let returned = false;

    await act(() => {
      void confirm();
      returned = true;
    });

    expect(returned).toBe(true);
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(1);
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({
      kind: 'setReference',
      sectionId: 's1',
      activityId: 'a2',
    });
    expect(hook.result.current.isReferenceSaving).toBe(true);
    expect(onSectionRefresh).not.toHaveBeenCalled();

    const second = confirmOf(() => hook.result.current.handleSetAsReference('a1'));
    await act(() => {
      void second();
    });

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(1);
  });

  it('refuses a second confirm from a prompt opened before the first edit began', async () => {
    const { hook, engine } = await mountWith(() => new Promise(() => {}));
    const first = confirmOf(() => hook.result.current.handleSetAsReference('a2'));
    const second = confirmOf(() => hook.result.current.handleSetAsReference('a1'));

    await act(() => {
      void first();
      void second();
    });

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(1);
  });

  it('takes the new reference and names the ride it took out once the edit ends', async () => {
    const { hook, engine, onSectionRefresh } = await mountWith(() => Promise.resolve([ride]));
    const confirm = confirmOf(() => hook.result.current.handleSetAsReference('a2'));

    await act(async () => {
      await confirm();
    });

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isReferenceSaving).toBe(false);
    expect(hook.result.current.effectiveReferenceId).toBe('a2');
    expect(onSectionRefresh).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['sections'] });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((Alert.alert as jest.Mock).mock.calls[0])).toContain('Harbour spin');
  });

  it('shows the failure and keeps the reference when the edit fails', async () => {
    const { hook, onSectionRefresh } = await mountWith(() => Promise.resolve(null));
    const confirm = confirmOf(() => hook.result.current.handleSetAsReference('a2'));

    await act(async () => {
      await confirm();
    });

    expect(hook.result.current.isReferenceSaving).toBe(false);
    expect(hook.result.current.effectiveReferenceId).toBe('a1');
    expect(onSectionRefresh).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('sections.referenceFailedTitle');
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('sections.setReferenceError');
  });

  it('runs a reset as an edit and refreshes once it ends', async () => {
    const pending = deferred();
    const { hook, engine, onSectionRefresh } = await mountWith(() => pending.promise, true);
    const confirm = confirmOf(() => hook.result.current.handleSetAsReference('a1'));

    await act(() => {
      void confirm();
    });

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({
      kind: 'resetReference',
      sectionId: 's1',
    });
    expect(hook.result.current.isReferenceSaving).toBe(true);
    expect(onSectionRefresh).not.toHaveBeenCalled();

    await act(async () => pending.settle([]));

    expect(hook.result.current.isReferenceSaving).toBe(false);
    expect(onSectionRefresh).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows the failure when a reset fails', async () => {
    const { hook, onSectionRefresh } = await mountWith(() => Promise.resolve(null), true);
    const confirm = confirmOf(() => hook.result.current.handleSetAsReference('a1'));

    await act(async () => {
      await confirm();
    });

    expect(onSectionRefresh).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('sections.referenceFailedTitle');
  });

  it('invalidates and announces an edit that ends after unmount without refreshing', async () => {
    const pending = deferred();
    const { hook, onSectionRefresh } = await mountWith(() => pending.promise);
    const confirm = confirmOf(() => hook.result.current.handleSetAsReference('a2'));
    await act(() => {
      void confirm();
    });
    await hook.unmount();

    await act(async () => pending.settle([ride]));

    expect(onSectionRefresh).not.toHaveBeenCalled();
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['sections'] });
    expect(JSON.stringify((Alert.alert as jest.Mock).mock.calls[0])).toContain('Harbour spin');
  });
});
