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
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import InsightsScreen from '@/app/(tabs)/insights';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
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
  IconButton: jest.requireActual('@/shared/ui/IconButton').IconButton,
  pressable: (style: unknown) => style,
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
const mockOpenExplainer = jest.fn();
jest.mock('@/shared/app/explainer', () => ({
  openExplainer: (...a: unknown[]) => mockOpenExplainer(...a),
}));
jest.mock('@/features/insights', () => ({
  aboutInsightsBody: () => 'insights.aboutBody',
  InsightsPanel: () => null,
  StrengthTab: () => null,
  useInsights: () => ({ insights: [], markAsSeen: jest.fn() }),
}));
jest.mock('@/features/routes/components/RoutesList', () => ({ RoutesList: () => null }));
jest.mock('@/features/routes/components/SectionsList', () => ({ SectionsList: () => null }));
jest.mock('@/features/routes/components/DateRangeSummary', () => ({
  DateRangeSummary: () => null,
}));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: jest.fn() }),
}));
jest.mock('@/features/routes/hooks/useRoutesScreenData', () => ({
  useRoutesScreenData: () => ({ data: { groups: [], activityCount: 0 } }),
}));

const mockFlags = { strength: 'hidden', routeMatching: false, debug: true };
jest.mock('@/features/strength', () => ({
  useStrengthTabState: () => mockFlags.strength,
  strengthPeriodOf: jest.requireActual('@/features/strength/periods').strengthPeriodOf,
}));
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
  ])('renders the page of each tab at its own index: %o', async (flags) => {
    Object.assign(mockFlags, flags);

    await render(<InsightsScreen />);

    expect(pairs()).toEqual(mockStrip.tabs.map((tab) => [tab.key, tab.key]));
    expect(mockStrip.pages).toHaveLength(mockStrip.tabs.length);
  });

  it('keeps developer tools out of the tab bar with debug mode on', async () => {
    Object.assign(mockFlags, { strength: 'shown', routeMatching: true, debug: true });

    await render(<InsightsScreen />);

    expect(mockStrip.tabs.map((tab) => tab.key)).toEqual([
      'insights',
      'strength',
      'routes',
      'sections',
    ]);
  });

  it('offers no Routes or Sections tab and shows the disabled hint with route matching off', async () => {
    Object.assign(mockFlags, { strength: 'shown', routeMatching: false, debug: true });

    await render(<InsightsScreen />);

    const keys = mockStrip.tabs.map((tab) => tab.key);
    expect(keys).not.toContain('routes');
    expect(keys).not.toContain('sections');
    expect(screen.getByText('insights.routesDisabledLine1')).toBeTruthy();
  });

  it('offers the Routes and Sections tabs and no disabled hint with route matching on', async () => {
    Object.assign(mockFlags, { strength: 'hidden', routeMatching: true, debug: false });

    await render(<InsightsScreen />);

    const keys = mockStrip.tabs.map((tab) => tab.key);
    expect(keys).toContain('routes');
    expect(keys).toContain('sections');
    expect(screen.queryByText('insights.routesDisabledLine1')).toBeNull();
  });

  it('says in its header that it is beta', async () => {
    Object.assign(mockFlags, { strength: 'hidden', routeMatching: true, debug: false });

    await render(<InsightsScreen />);

    expect(screen.getByTestId('insights-beta-marker')).toBeTruthy();
    expect(screen.getByText('insights.beta')).toBeTruthy();
  });

  it('names the control that explains the screen', async () => {
    Object.assign(mockFlags, { strength: 'hidden', routeMatching: true, debug: false });

    await render(<InsightsScreen />);

    expect(screen.getByRole('button', { name: 'insights.aboutTitle' })).toBeTruthy();
  });

  it('opens the explanation of the screen in the explainer sheet, not an alert', async () => {
    Object.assign(mockFlags, { strength: 'hidden', routeMatching: true, debug: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockOpenExplainer.mockClear();

    await render(<InsightsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'insights.aboutTitle' }));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockOpenExplainer).toHaveBeenCalledWith({
      title: 'insights.aboutTitle',
      body: 'insights.aboutBody',
    });
    alertSpy.mockRestore();
  });

  it('leaves a failed engine start to the global banner and shows none of its own', async () => {
    Object.assign(mockFlags, { strength: 'hidden', routeMatching: true, debug: false });
    mockEngine.initFailed = true;

    await render(<InsightsScreen />);
    mockEngine.initFailed = false;

    expect(screen.queryByText('engine.initFailed')).toBeNull();
  });

  it('lands on strength again when a second card pushes the same tab after a swipe away', async () => {
    Object.assign(mockFlags, { strength: 'shown', routeMatching: false, debug: false });
    mockParams.current = {};
    const { rerender } = await render(<InsightsScreen />);

    const push = async () => {
      mockParams.current = { ...mockParams.current, tab: 'strength' };
      await rerender(<InsightsScreen />);
    };

    await push();
    expect(mockStrip.activeTab).toBe('strength');

    await act(() => mockStrip.onTabChange?.('insights'));
    expect(mockStrip.activeTab).toBe('insights');

    await push();
    expect(mockStrip.activeTab).toBe('strength');
  });
});

describe('a link to the strength tab that names a period', () => {
  /** The period the strength page was handed, read off the page the strip holds. */
  function linkedPeriod(): string | undefined {
    const page = mockStrip.pages[mockStrip.tabs.findIndex((tab) => tab.key === 'strength')];
    return (page?.props as { linkedPeriod?: { period: string } } | undefined)?.linkedPeriod?.period;
  }

  beforeEach(() => {
    Object.assign(mockFlags, { strength: 'shown', routeMatching: false, debug: false });
  });

  it('hands the named period to the strength tab on the first render and clears the param', async () => {
    mockParams.current = { tab: 'strength', period: '1m' };

    await render(<InsightsScreen />);

    expect(mockStrip.activeTab).toBe('strength');
    expect(linkedPeriod()).toBe('1m');
    expect(mockParams.current.period).toBeUndefined();
  });

  it.each(['bogus', '1y', 'all', ''])('leaves the tab its own period for %p', async (period) => {
    mockParams.current = { tab: 'strength', period };

    await render(<InsightsScreen />);

    expect(mockStrip.activeTab).toBe('strength');
    expect(linkedPeriod()).toBeUndefined();
  });

  it('leaves the tab its own period when the link names none', async () => {
    mockParams.current = { tab: 'strength' };

    await render(<InsightsScreen />);

    expect(linkedPeriod()).toBeUndefined();
  });

  it('moves the mounted tab to the period a second link names', async () => {
    mockParams.current = { tab: 'strength', period: '1m' };
    const { rerender } = await render(<InsightsScreen />);
    await rerender(<InsightsScreen />);
    expect(linkedPeriod()).toBe('1m');

    mockParams.current = { ...mockParams.current, tab: 'strength', period: '7d' };
    await rerender(<InsightsScreen />);

    expect(linkedPeriod()).toBe('7d');
    expect(mockParams.current.period).toBeUndefined();
  });

  it('hands a fresh link when a second link names the same period again', async () => {
    mockParams.current = { tab: 'strength', period: '1m' };
    const { rerender } = await render(<InsightsScreen />);
    await rerender(<InsightsScreen />);
    const page = mockStrip.pages[mockStrip.tabs.findIndex((tab) => tab.key === 'strength')];
    const first = (page.props as { linkedPeriod?: object }).linkedPeriod;

    mockParams.current = { ...mockParams.current, period: '1m' };
    await rerender(<InsightsScreen />);

    const again = mockStrip.pages[mockStrip.tabs.findIndex((tab) => tab.key === 'strength')];
    const second = (again.props as { linkedPeriod?: object }).linkedPeriod;
    expect(second).toEqual({ period: '1m' });
    expect(second).not.toBe(first);
  });
});
