/**
 * Scenario: the retired sections screen reads the ledger in a useMemo keyed on
 * nothing, on the one screen whose content is exactly what a `sections` event
 * announces.
 *
 * Expected behaviour: a retirement that lands while the screen is open shows up.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SectionRetiredScreen from '@/app/section-retired';
import { layout } from '@/theme/layout';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    sections: {
      getRetiredMapData: () => ({
        retired: mockGetRetiredSections().map((section) => ({ section })),
        current: [],
        pairs: [],
      }),
    },
  })
);

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#666' } }),
  useMetricSystem: () => true,
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
}));

jest.mock('@/features/routes/lib/sectionDisplayNames', () => ({
  getAllSectionDisplayNames: () => ({ 'sec-2': 'Church Hill' }),
}));

const mockListeners = new Map<string, Set<() => void>>();
const mockGetRetiredSections = jest.fn<
  {
    sectionId: string;
    kind: string;
    at: string;
    versions: [];
    into?: string;
    name?: string;
    distanceMeters?: number;
    restorableVersion?: number;
  }[],
  []
>(() => []);

const mockRunSectionBoundsEdit = jest.fn<Promise<unknown[]>, [unknown]>(async () => []);
const mockChooseAction = jest.fn();
const mockNavigateTo = jest.fn();

jest.mock('@/shared/ui/dialog', () => ({
  ...jest.requireActual('@/shared/ui/dialog'),
  chooseAction: (args: unknown) => mockChooseAction(args),
  inform: jest.fn(),
}));

jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: (to: string) => mockNavigateTo(to),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    subscribe: (event: string, cb: () => void) => {
      const set = mockListeners.get(event) ?? new Set<() => void>();
      set.add(cb);
      mockListeners.set(event, set);
      return () => set.delete(cb);
    },
    runSectionBoundsEdit: (edit: unknown) => mockRunSectionBoundsEdit(edit),
  }),
  isEngineReady: () => true,
}));

async function emit(event: string) {
  await act(() => {
    mockListeners.get(event)?.forEach((cb) => cb());
  });
}

function retirement(sectionId: string) {
  return { sectionId, kind: 'merged', at: '2026-08-01 10:00:00', versions: [] as [] };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  mockGetRetiredSections.mockReturnValue([]);
});

describe('retired sections screen', () => {
  it('shows a retirement that lands while the screen is open', async () => {
    const screen = await render(<SectionRetiredScreen />);
    expect(screen.queryByTestId('section-retired-sec-1')).toBeNull();

    mockGetRetiredSections.mockReturnValue([retirement('sec-1')]);
    await emit('sections');

    expect(screen.getByTestId('section-retired-sec-1')).toBeTruthy();
  });

  it('drops one that a later event no longer reports', async () => {
    mockGetRetiredSections.mockReturnValue([retirement('sec-1')]);
    const screen = await render(<SectionRetiredScreen />);
    expect(screen.getByTestId('section-retired-sec-1')).toBeTruthy();

    mockGetRetiredSections.mockReturnValue([]);
    await emit('sections');

    expect(screen.queryByTestId('section-retired-sec-1')).toBeNull();
  });

  it('does not re-read on an event it does not depend on', async () => {
    await render(<SectionRetiredScreen />);
    const afterMount = mockGetRetiredSections.mock.calls.length;

    await emit('groups');
    expect(mockGetRetiredSections.mock.calls.length).toBe(afterMount);
  });
});

describe('a retirement merged into another section', () => {
  it('takes the press on the whole card, named by the link, at the tap-target floor', () => {
    mockGetRetiredSections.mockReturnValue([{ ...retirement('sec-1'), into: 'sec-2' }]);
    const screen = render(<SectionRetiredScreen />);

    const card = screen.getByTestId('section-retired-sec-1');
    expect(card.props.accessibilityRole).toBe('link');
    expect(screen.getByText(card.props.accessibilityLabel)).toBeTruthy();
    const style = StyleSheet.flatten(
      typeof card.props.style === 'function'
        ? card.props.style({ pressed: false })
        : card.props.style
    ) as { minHeight?: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(layout.minTapTarget);
  });
});

describe('each retired card', () => {
  it('leads with the name the section last had, so two retirements can be told apart', () => {
    mockGetRetiredSections.mockReturnValue([
      { ...retirement('sec-1'), kind: 'dissolved', name: 'Old Quarry', distanceMeters: 1500 },
      { ...retirement('sec-3'), into: 'sec-2', name: 'Lower Church Hill', distanceMeters: 820 },
    ]);
    const screen = render(<SectionRetiredScreen />);

    const quarry = screen.getByText('Old Quarry');
    expect(quarry.props.numberOfLines).toBe(2);
    expect(screen.getByText('Lower Church Hill')).toBeTruthy();
    expect(screen.getByText(/1\.5 km/)).toBeTruthy();
    expect(screen.getByText(/820 m/)).toBeTruthy();
  });

  it('falls back to how it left when the ledger kept no name', () => {
    mockGetRetiredSections.mockReturnValue([{ ...retirement('sec-1'), kind: 'dissolved' }]);
    const screen = render(<SectionRetiredScreen />);

    expect(screen.getByTestId('section-retired-sec-1')).toBeTruthy();
    expect(screen.queryByText(/km|\bm\b/)).toBeNull();
  });
});

describe('restoring a retired section', () => {
  it('offers Restore only on a card whose section has a version to restore from', () => {
    mockGetRetiredSections.mockReturnValue([
      { ...retirement('sec-1'), kind: 'dissolved', restorableVersion: 3 },
      { ...retirement('sec-2'), kind: 'dissolved' },
    ]);
    const screen = render(<SectionRetiredScreen />);

    expect(screen.getByTestId('section-retired-restore-sec-1')).toBeTruthy();
    expect(screen.queryByTestId('section-retired-restore-sec-2')).toBeNull();
  });

  it('reverts to the reported version, drops the card and offers to open the section', async () => {
    mockGetRetiredSections.mockReturnValue([
      { ...retirement('sec-1'), kind: 'dissolved', name: 'Old Quarry', restorableVersion: 3 },
    ]);
    const screen = await render(<SectionRetiredScreen />);

    mockGetRetiredSections.mockReturnValue([]);
    await fireEvent.press(screen.getByTestId('section-retired-restore-sec-1'));

    await waitFor(() =>
      expect(mockRunSectionBoundsEdit).toHaveBeenCalledWith({
        kind: 'revert',
        sectionId: 'sec-1',
        version: 3,
      })
    );
    await emit('sections');
    expect(screen.queryByTestId('section-retired-sec-1')).toBeNull();

    await waitFor(() => expect(mockChooseAction).toHaveBeenCalled());
    mockChooseAction.mock.calls[0][0].actions[0].onPress();
    expect(mockNavigateTo).toHaveBeenCalledWith('/section/sec-1');
  });

  it('keeps the card and offers no Open when the restore fails', async () => {
    mockRunSectionBoundsEdit.mockRejectedValueOnce(new Error('refused'));
    mockGetRetiredSections.mockReturnValue([
      { ...retirement('sec-1'), kind: 'dissolved', restorableVersion: 3 },
    ]);
    const screen = await render(<SectionRetiredScreen />);

    await fireEvent.press(screen.getByTestId('section-retired-restore-sec-1'));

    await waitFor(() => expect(mockRunSectionBoundsEdit).toHaveBeenCalled());
    expect(mockChooseAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('section-retired-sec-1')).toBeTruthy();
  });
});
