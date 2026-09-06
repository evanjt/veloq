/**
 * Scenario: the retired sections screen reads the ledger in a useMemo keyed on
 * nothing, on the one screen whose content is exactly what a `sections` event
 * announces.
 *
 * Expected behaviour: a retirement that lands while the screen is open shows up.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import SectionRetiredScreen from '@/app/section-retired';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#666' } }),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
}));

jest.mock('@/features/routes/lib/sectionDisplayNames', () => ({
  getAllSectionDisplayNames: () => ({ 'sec-2': 'Church Hill' }),
}));

const mockListeners = new Map<string, Set<() => void>>();
const mockGetRetiredSections = jest.fn<
  { sectionId: string; kind: string; at: string; versions: [] }[],
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
}));

function emit(event: string) {
  act(() => {
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
  it('shows a retirement that lands while the screen is open', () => {
    const screen = render(<SectionRetiredScreen />);
    expect(screen.queryByTestId('section-retired-sec-1')).toBeNull();

    mockGetRetiredSections.mockReturnValue([retirement('sec-1')]);
    emit('sections');

    expect(screen.getByTestId('section-retired-sec-1')).toBeTruthy();
  });

  it('drops one that a later event no longer reports', () => {
    mockGetRetiredSections.mockReturnValue([retirement('sec-1')]);
    const screen = render(<SectionRetiredScreen />);
    expect(screen.getByTestId('section-retired-sec-1')).toBeTruthy();

    mockGetRetiredSections.mockReturnValue([]);
    emit('sections');

    expect(screen.queryByTestId('section-retired-sec-1')).toBeNull();
  });

  it('does not re-read on an event it does not depend on', () => {
    render(<SectionRetiredScreen />);
    const afterMount = mockGetRetiredSections.mock.calls.length;

    emit('groups');
    expect(mockGetRetiredSections.mock.calls.length).toBe(afterMount);
  });
});
