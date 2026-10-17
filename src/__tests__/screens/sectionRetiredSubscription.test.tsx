/**
 * Scenario: the retired sections screen reads the ledger in a useMemo keyed on
 * nothing, on the one screen whose content is exactly what a `sections` event
 * announces.
 *
 * Expected behaviour: a retirement that lands while the screen is open shows up.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

import SectionRetiredScreen from '@/app/section-retired';
import { layout } from '@/theme/layout';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

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
  }[],
  []
>(() => []);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    subscribe: (event: string, cb: () => void) => {
      const set = mockListeners.get(event) ?? new Set<() => void>();
      set.add(cb);
      mockListeners.set(event, set);
      return () => set.delete(cb);
    },
    getRetiredSections: () => mockGetRetiredSections(),
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
