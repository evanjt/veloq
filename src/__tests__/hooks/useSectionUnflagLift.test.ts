import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';

/**
 * Scenario: the detector flags a section as lift ground and the athlete knows
 * it is not one.
 * Expected behaviour: the tap asks first. The write is an intent that outlives
 * every re-detect and nothing in the app can put the flag back, so a thumb
 * landing on the badge while scrolling must not spend it. Confirming writes
 * once and re-reads the section so the badge goes; a refusal leaves the badge
 * up rather than hiding a flag that is still set.
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

/** The buttons the alert was raised with, in the order it was given them. */
function alertButtons() {
  const spy = Alert.alert as jest.Mock;
  expect(spy).toHaveBeenCalledTimes(1);
  return (spy.mock.calls[0][2] ?? []) as { text: string; style?: string; onPress?: () => void }[];
}

function press(label: string) {
  const button = alertButtons().find((b) => b.text === label);
  expect(button).toBeDefined();
  act(() => button?.onPress?.());
}

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
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('writes nothing on the tap alone', () => {
    const setSectionIsLift = jest.fn(() => true);
    const { hook, onSectionRefresh } = mountWith({ setSectionIsLift });

    act(() => hook.result.current.handleUnflagLift());

    expect(Alert.alert).toHaveBeenCalled();
    expect(setSectionIsLift).not.toHaveBeenCalled();
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });

  it('says what the confirmation does, and offers a way out of it', () => {
    const { hook } = mountWith({ setSectionIsLift: jest.fn(() => true) });

    act(() => hook.result.current.handleUnflagLift());

    const [title, body] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('sections.unflagLift');
    expect(body).toBe('sections.unflagLiftConfirm');
    expect(alertButtons().map((b) => b.style)).toContain('cancel');
  });

  it('writes once and refreshes the section when the athlete confirms', () => {
    const setSectionIsLift = jest.fn(() => true);
    const { hook, onSectionRefresh } = mountWith({ setSectionIsLift });

    act(() => hook.result.current.handleUnflagLift());
    press('common.remove');

    expect(setSectionIsLift).toHaveBeenCalledTimes(1);
    expect(setSectionIsLift).toHaveBeenCalledWith('s1', false);
    expect(onSectionRefresh).toHaveBeenCalled();
  });

  it('writes nothing when the athlete cancels', () => {
    const setSectionIsLift = jest.fn(() => true);
    const { hook, onSectionRefresh } = mountWith({ setSectionIsLift });

    act(() => hook.result.current.handleUnflagLift());
    const cancel = alertButtons().find((b) => b.style === 'cancel');
    act(() => cancel?.onPress?.());

    expect(setSectionIsLift).not.toHaveBeenCalled();
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });

  it('does not ask when the engine is not up', () => {
    const { hook, onSectionRefresh } = mountWith(null);

    act(() => hook.result.current.handleUnflagLift());

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });

  it('does not refresh when the engine refuses the confirmed write', () => {
    const setSectionIsLift = jest.fn(() => false);
    const { hook, onSectionRefresh } = mountWith({ setSectionIsLift });

    act(() => hook.result.current.handleUnflagLift());
    press('common.remove');

    expect(setSectionIsLift).toHaveBeenCalledWith('s1', false);
    expect(onSectionRefresh).not.toHaveBeenCalled();
  });
});
