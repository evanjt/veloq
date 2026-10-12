/**
 * Scenario: the engine throws a tagged failure while a surface reads a section
 * or a route group list.
 *
 * Expected behaviour: the surface shows the failure's message rather than the
 * empty or not-found state it draws for a read that answered nothing.
 */

import React from 'react';
import { router } from 'expo-router';
import { fireEvent, render, renderHook } from '@testing-library/react-native';

import { SectionPRContent } from '@/features/insights/components/content/SectionPRContent';
import { StalePRContent } from '@/features/insights/components/content/StalePRContent';
import { SectionTrendContent } from '@/features/insights/components/content/SectionTrendContent';
import RouteOverlaySheet from '@/app/sheets/route-overlay';
import { openSheet } from '@/shared/app/sheetRequest';
import { useRouteGroups } from '@/features/routes/hooks/useRouteGroups';
import { engineErrorTag } from '@/shared/native/engineError';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
const mockSheetParams: { request?: string } = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockSheetParams,
}));
jest.mock('@/features/activity', () => ({
  ActivityCardContextMenu: ({ children }: { children: React.ReactNode }) => children,
  SkylineBar: () => null,
}));
jest.mock('react-native-body-highlighter', () => ({
  ...jest.requireActual('react-native-body-highlighter'),
  __esModule: true,
  default: () => null,
}));

const lockFailed = { tag: 'Database', inner: { msg: 'poisoned' } };
const mockRetrySection = jest.fn();

jest.mock('@/shared/native/useSectionDetail', () => ({ useSectionDetail: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useGroupSummaries: jest.fn(),
  useEngineGroups: jest.fn(),
}));
jest.mock('@/features/routes/hooks/useSectionPerformances', () => ({
  useSectionPerformances: jest.fn(),
}));

const mockRefetchStreams = jest.fn();
const { useSectionPerformances: mockPerformances } = jest.requireMock(
  '@/features/routes/hooks/useSectionPerformances'
) as { useSectionPerformances: jest.Mock };

function performances(overrides: { isLoading?: boolean; error?: string | null } = {}) {
  return {
    records: [],
    bests: { forward: null, reverse: null, forwardIsPr: false, reverseIsPr: false },
    isLoading: false,
    error: null,
    refetch: mockRefetchStreams,
    ...overrides,
  };
}

const engineHooks = {
  ...(jest.requireMock('@/shared/native/useSectionDetail') as { useSectionDetail: jest.Mock }),
  ...(jest.requireMock('@/features/routes/hooks/useEngine') as {
    useGroupSummaries: jest.Mock;
    useEngineGroups: jest.Mock;
  }),
};

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: jest.requireActual('@/theme').colors }),
  useMetricSystem: () => true,
  useAthlete: () => ({ data: null }),
}));

function insight(category: 'section_pr' | 'section_trend' | 'stale_pr'): Insight {
  return {
    id: 'i1',
    category,
    priority: 1,
    title: 'Section',
    icon: 'trophy-outline',
    iconTone: 'record',
    timestamp: 0,
    isNew: false,
    supportingData: {
      sections: [{ sectionId: 's1', sectionName: 'Hill', bestTime: 300, trend: 0 }],
    },
  } as Insight;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPerformances.mockReturnValue(performances());
  engineHooks.useSectionDetail.mockReturnValue({
    section: null,
    error: lockFailed,
    retry: mockRetrySection,
  });
  engineHooks.useGroupSummaries.mockReturnValue({
    totalCount: 0,
    summaries: [],
    error: lockFailed,
  });
  engineHooks.useEngineGroups.mockReturnValue({ groups: [], totalCount: 0, error: lockFailed });
});

describe('insight sheets', () => {
  it('SectionPRContent shows the failure rather than an empty sheet', async () => {
    const { getByTestId } = await render(<SectionPRContent insight={insight('section_pr')} />);
    expect(getByTestId('section-read-failure')).toHaveTextContent(/engine\.failure\.database/);
    await fireEvent.press(getByTestId('section-read-failure-retry'));
    expect(mockRetrySection).toHaveBeenCalledTimes(1);
  });

  it('StalePRContent shows the failure where the map would be', async () => {
    const { getByTestId } = await render(<StalePRContent insight={insight('stale_pr')} />);
    expect(getByTestId('section-read-failure')).toHaveTextContent(/engine\.failure\.database/);
    expect(getByTestId('section-read-failure-retry')).toBeTruthy();
  });

  it('an opened trend row shows the failure instead of the no-efforts line', async () => {
    const { getByTestId, queryByText } = await render(
      <SectionTrendContent insight={insight('section_trend')} />
    );
    await fireEvent.press(getByTestId('section-trend-toggle-s1'));
    expect(getByTestId('section-read-failure')).toBeTruthy();
    expect(queryByText('insights.sectionTrendSheet.noEfforts')).toBeNull();
  });

  it('a read that answers nothing draws no failure', async () => {
    engineHooks.useSectionDetail.mockReturnValue({ section: null });
    const { queryByTestId } = await render(<SectionPRContent insight={insight('section_pr')} />);
    expect(queryByTestId('section-read-failure')).toBeNull();
  });
});

/// Scenario: the section reads, but reading or requesting its time streams
/// throws. The sync settles failed and the cards drew a spinner for good.
///
/// Expected behaviour: each card shows the failure with a Retry that asks again.
describe('insight sheets whose time streams failed', () => {
  beforeEach(() => {
    engineHooks.useSectionDetail.mockReturnValue({ section: null });
    mockPerformances.mockReturnValue(
      performances({ error: 'Failed to load activity streams', isLoading: false })
    );
  });

  it('SectionPRContent shows a retry in place of the timeline', async () => {
    const { getByTestId, getByText } = await render(
      <SectionPRContent insight={insight('section_pr')} />
    );
    expect(getByTestId('section-stream-failure')).toBeTruthy();
    await fireEvent.press(getByText('common.retry'));
    expect(mockRefetchStreams).toHaveBeenCalledTimes(1);
  });

  it('an opened trend row shows a retry instead of the no-efforts line', async () => {
    const { getByTestId, getByText, queryByText } = await render(
      <SectionTrendContent insight={insight('section_trend')} />
    );
    await fireEvent.press(getByTestId('section-trend-toggle-s1'));
    expect(getByTestId('section-stream-failure')).toBeTruthy();
    expect(queryByText('insights.sectionTrendSheet.noEfforts')).toBeNull();
    await fireEvent.press(getByText('common.retry'));
    expect(mockRefetchStreams).toHaveBeenCalledTimes(1);
  });

  it('draws no retry while the streams are still loading', async () => {
    mockPerformances.mockReturnValue(performances({ isLoading: true }));
    const { queryByTestId } = await render(<SectionPRContent insight={insight('section_pr')} />);
    expect(queryByTestId('section-stream-failure')).toBeNull();
  });
});

describe('RouteOverlaySheet', () => {
  it('shows the failure instead of "no saved routes"', async () => {
    openSheet('sheets/route-overlay', { activityType: 'Ride', selectedRouteId: null });
    mockSheetParams.request = (router.push as jest.Mock).mock.calls.at(-1)[0].params.request;
    const { getByTestId, queryByText } = await render(<RouteOverlaySheet />);
    expect(getByTestId('route-groups-failure').props.children).toBe('engine.failure.database');
    expect(queryByText('No saved routes for this sport yet.')).toBeNull();
  });
});

describe('route hooks hand the failure on', () => {
  it('useRouteGroups returns the error of its summaries read', async () => {
    const { result } = await renderHook(() => useRouteGroups());
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });
});
