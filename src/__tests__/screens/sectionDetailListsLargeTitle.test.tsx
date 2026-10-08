/**
 * Scenario: the section history and exercise history screens take a collapsing large title on iOS,
 * which only holds when each screen's scroll view lets the system inset its content. The section
 * laps screen scrolled under a title that never collapsed on iOS 26, so it keeps the small one.
 *
 * Expected behaviour: history and exercise history set `largeTitle`, laps does not, and rendered
 * on iOS each first scroll view has `contentInsetAdjustmentBehavior: 'automatic'`.
 */

import React from 'react';
import { Platform, ScrollView } from 'react-native';
import { render } from '@testing-library/react-native';

import { headerLargeTitle } from '@/shared/app/screenHeaders';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'section-1', category: '3' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), tapTo: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: () => ({ data: null, isLoading: false, isError: false }),
}));
jest.mock('@/shared/native/useEngineSubscription', () => ({ useEngineSubscription: () => 0 }));

jest.mock('@/features/routes', () => ({
  DetailFallback: () => null,
  SectionLapList: () => null,
  SectionStreamsNotice: () => null,
  SectionHistoryPanel: () => null,
  RANGE_DAYS: { all: 0 },
  useSectionDetailData: () => ({
    data: { section: { activityPortions: [] }, missingTimeStreamIds: [] },
    status: { kind: 'open' },
  }),
  useSectionDetailPerformance: () => ({ data: { lapRecords: [] }, error: undefined }),
  useSectionTimeStreamSync: () => ({
    ready: true,
    error: undefined,
    outstanding: 0,
    refetch: jest.fn(),
  }),
  toPerformanceRecord: (record: unknown) => record,
  withoutRecordMarks: (records: unknown) => records,
  useSectionLaps: () => ({ excludeLap: jest.fn(), includeLap: jest.fn() }),
  useSectionLedger: () => ({
    history: [],
    versions: [],
    pinnedVersion: null,
    revert: jest.fn(),
    unpin: jest.fn(),
  }),
  useLedgerActivityNames: () => ({}),
}));

const SCREENS: [route: string, load: () => React.ComponentType][] = [
  ['section/laps/[id]', () => require('@/app/section/laps/[id]').default],
  ['section/history/[id]', () => require('@/app/section/history/[id]').default],
  ['exercise/[category]', () => require('@/app/exercise/[category]').default],
];

describe('section and exercise detail lists', () => {
  it.each(SCREENS.filter(([route]) => route !== 'section/laps/[id]'))(
    '%s takes a large title on iOS',
    (route) => {
      expect(headerLargeTitle(route, 'ios')).toBe(true);
      expect(headerLargeTitle(route, 'android')).toBe(false);
    }
  );

  it('keeps the small title on the section laps screen', () => {
    expect(headerLargeTitle('section/laps/[id]', 'ios')).toBe(false);
    expect(headerLargeTitle('section/laps/[id]', 'android')).toBe(false);
  });

  it.each(SCREENS)('%s lets the system inset its scroll view on iOS', (_route, load) => {
    Platform.OS = 'ios';
    const Screen = load();
    const { UNSAFE_getAllByType } = render(<Screen />);

    const scroll = UNSAFE_getAllByType(ScrollView)[0];
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('automatic');
  });
});
