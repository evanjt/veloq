/**
 * Scenario: debug mode on, route matching off, no strength data. The tabs were
 * [Insights, Sync] and the pages [insights, routes, sections, debug], and the
 * tab strip renders page N for tab N, so tapping Sync showed the routes page's
 * disabled notice and the sync page could not be reached. Separately, the
 * screen shipped as beta on the 2026-04-11 decision and said so nowhere.
 *
 * Expected behaviour: each tab has the page of its own key at its own index,
 * whatever is switched off, and the header carries the beta marker.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import InsightsScreen from '@/app/(tabs)/insights';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockParams.current,
  router: {
    push: jest.fn(),
    setParams: (next: Record<string, string | undefined>) => {
      mockParams.current = { ...mockParams.current, ...next };
      for (const key of Object.keys(mockParams.current)) {
        if (mockParams.current[key] === undefined) delete mockParams.current[key];
      }
    },
  },
}));
const mockParams: { current: Record<string, string | undefined> } = { current: {} };

/** The strip as it renders: one page per position, read by index. */
const mockStrip: {
  tabs: { key: string }[];
  pages: React.ReactElement[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
} = { tabs: [], pages: [] };
jest.mock('@/shared/ui', () => ({
  ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
  ScreenSafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  SwipeableTabs: ({
    tabs,
    children,
    activeTab,
    onTabChange,
  }: {
    tabs: { key: string }[];
    children: React.ReactNode;
    activeTab: string;
    onTabChange: (key: string) => void;
  }) => {
    const React = require('react');
    mockStrip.activeTab = activeTab;
    mockStrip.onTabChange = onTabChange;
    mockStrip.tabs = tabs;
    mockStrip.pages = React.Children.toArray(children);
    return null;
  },
}));
jest.mock('@/features/insights', () => ({
  aboutInsightsBody: jest.fn(),
  InsightsPanel: () => null,
  StrengthTab: () => null,
  useInsights: () => ({ insights: [], markAsSeen: jest.fn() }),
}));
jest.mock('@/features/routes/components/RoutesList', () => ({ RoutesList: () => null }));
jest.mock('@/features/routes/components/SectionsList', () => ({ SectionsList: () => null }));
jest.mock('@/features/routes/components/DateRangeSummary', () => ({
  DateRangeSummary: () => null,
}));
jest.mock('@/features/routes/components/SyncDebugTab', () => ({ SyncDebugTab: () => null }));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ count: 0 }),
}));
jest.mock('@/features/routes/hooks/useRoutesScreenData', () => ({
  useRoutesScreenData: () => ({ data: { groups: [], activityCount: 0 } }),
}));

const mockFlags = { strength: 'hidden', routeMatching: false, debug: true };
jest.mock('@/features/strength', () => ({ useStrengthTabState: () => mockFlags.strength }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useUserLocation', () => ({
  useUserLocation: () => ({ location: null, requestPermission: jest.fn() }),
}));
const mockEngine = { initFailed: false };
jest.mock('@/features/routes/stores/EngineStatusStore', () => ({
  useEngineStatus: (select: (state: object) => unknown) => select({ ...mockEngine }),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: Object.assign(
    (select: (state: object) => unknown) =>
      select({ settings: { enabled: mockFlags.routeMatching } }),
    { getState: () => ({ setEnabled: jest.fn() }) }
  ),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  useDebugStore: (select: (state: object) => unknown) => select({ enabled: mockFlags.debug }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (select: (state: object) => unknown) =>
    select({
      oldest: null,
      newest: null,
      extendedFetch: { phase: 'idle' },
      gpsSyncProgress: { status: 'idle' },
      isGpsSyncing: false,
    }),
}));
jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => jest.fn() }));

/** Each tab's key beside the key of the page rendered at its index. */
function pairs(): [string, string | undefined][] {
  return mockStrip.tabs.map((tab, i) => [
    tab.key,
    String(mockStrip.pages[i]?.key ?? '').replace(/^\.\$/, ''),
  ]);
}

describe('the Insights screen', () => {
  it.each([
    { strength: 'hidden', routeMatching: false, debug: true },
    { strength: 'shown', routeMatching: false, debug: true },
    { strength: 'shown', routeMatching: true, debug: true },
    { strength: 'hidden', routeMatching: true, debug: false },
    { strength: 'hidden', routeMatching: false, debug: false },
  ])('renders the page of each tab at its own index: %o', (flags) => {
    Object.assign(mockFlags, flags);

    render(<InsightsScreen />);

    expect(pairs()).toEqual(mockStrip.tabs.map((tab) => [tab.key, tab.key]));
    expect(mockStrip.pages).toHaveLength(mockStrip.tabs.length);
  });

  it('offers no Routes or Sections tab and shows the disabled hint with route matching off', () => {
    Object.assign(mockFlags, { strength: 'shown', routeMatching: false, debug: true });

    render(<InsightsScreen />);

    const keys = mockStrip.tabs.map((tab) => tab.key);
    expect(keys).not.toContain('routes');
    expect(keys).not.toContain('sections');
    expect(screen.getByText('insights.routesDisabledLine1')).toBeTruthy();
  });

  it('offers the Routes and Sections tabs and no disabled hint with route matching on', () => {
    Object.assign(mockFlags, { strength: 'hidden', routeMatching: true, debug: false });

    render(<InsightsScreen />);

    const keys = mockStrip.tabs.map((tab) => tab.key);
    expect(keys).toContain('routes');
    expect(keys).toContain('sections');
    expect(screen.queryByText('insights.routesDisabledLine1')).toBeNull();
  });

  it('says in its header that it is beta', () => {
    Object.assign(mockFlags, { strength: 'hidden', routeMatching: true, debug: false });

    render(<InsightsScreen />);

    expect(screen.getByTestId('insights-beta-marker')).toBeTruthy();
    expect(screen.getByText('insights.beta')).toBeTruthy();
  });

  it('leaves a failed engine start to the global banner and shows none of its own', () => {
    Object.assign(mockFlags, { strength: 'hidden', routeMatching: true, debug: false });
    mockEngine.initFailed = true;

    render(<InsightsScreen />);
    mockEngine.initFailed = false;

    expect(screen.queryByText('engine.initFailed')).toBeNull();
  });

  it('lands on strength again when a second card pushes the same tab after a swipe away', () => {
    Object.assign(mockFlags, { strength: 'shown', routeMatching: false, debug: false });
    mockParams.current = {};
    const { rerender } = render(<InsightsScreen />);

    const push = () => {
      mockParams.current = { ...mockParams.current, tab: 'strength' };
      rerender(<InsightsScreen />);
    };

    push();
    expect(mockStrip.activeTab).toBe('strength');

    act(() => mockStrip.onTabChange?.('insights'));
    expect(mockStrip.activeTab).toBe('insights');

    push();
    expect(mockStrip.activeTab).toBe('strength');
  });
});
