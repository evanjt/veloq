/**
 * Scenario: the engine throws a tagged failure while a surface reads a section,
 * a route group list or an activity's muscles.
 *
 * Expected behaviour: the surface shows the failure's message rather than the
 * empty or not-found state it draws for a read that answered nothing.
 */

import React from 'react';
import { fireEvent, render, renderHook } from '@testing-library/react-native';

import { SectionPRContent } from '@/features/insights/components/content/SectionPRContent';
import { StalePRContent } from '@/features/insights/components/content/StalePRContent';
import { SectionTrendContent } from '@/features/insights/components/content/SectionTrendContent';
import { RouteOverlayPicker } from '@/features/recording/components/RouteOverlayPicker';
import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import { useRouteGroups } from '@/features/routes/hooks/useRouteGroups';
import { engineErrorTag } from '@/shared/native/engineError';
import type { Activity, Insight } from '@/types';

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
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));
jest.mock('@/features/activity', () => ({
  ActivityCardContextMenu: () => null,
  SkylineBar: () => null,
}));
jest.mock('react-native-body-highlighter', () => ({
  ...jest.requireActual('react-native-body-highlighter'),
  __esModule: true,
  default: () => null,
}));

const lockFailed = { tag: 'Database', inner: { msg: 'poisoned' } };

jest.mock('@/shared/native/useSectionDetail', () => ({ useSectionDetail: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useGroupSummaries: jest.fn(),
  useEngineGroups: jest.fn(),
}));
jest.mock('@/features/routes/hooks/useSectionPerformances', () => ({
  useSectionPerformances: () => ({
    records: [],
    bests: { forward: null, reverse: null, forwardIsPr: false, reverseIsPr: false },
  }),
}));

const engineHooks = {
  ...(jest.requireMock('@/shared/native/useSectionDetail') as { useSectionDetail: jest.Mock }),
  ...(jest.requireMock('@/features/routes/hooks/useEngine') as {
    useGroupSummaries: jest.Mock;
    useEngineGroups: jest.Mock;
  }),
};

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
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
  engineHooks.useSectionDetail.mockReturnValue({ section: null, error: lockFailed });
  engineHooks.useGroupSummaries.mockReturnValue({
    totalCount: 0,
    summaries: [],
    error: lockFailed,
  });
  engineHooks.useEngineGroups.mockReturnValue({ groups: [], totalCount: 0, error: lockFailed });
});

describe('insight sheets', () => {
  it('SectionPRContent shows the failure rather than an empty sheet', () => {
    const { getByTestId } = render(<SectionPRContent insight={insight('section_pr')} />);
    expect(getByTestId('section-read-failure').props.children).toBe('engine.failure.database');
  });

  it('StalePRContent shows the failure where the map would be', () => {
    const { getByTestId } = render(<StalePRContent insight={insight('stale_pr')} />);
    expect(getByTestId('section-read-failure').props.children).toBe('engine.failure.database');
  });

  it('an opened trend row shows the failure instead of the no-efforts line', () => {
    const { getByTestId, queryByText } = render(
      <SectionTrendContent insight={insight('section_trend')} />
    );
    fireEvent.press(getByTestId('section-trend-toggle-s1'));
    expect(getByTestId('section-read-failure')).toBeTruthy();
    expect(queryByText('insights.sectionTrendSheet.noEfforts')).toBeNull();
  });

  it('a read that answers nothing draws no failure', () => {
    engineHooks.useSectionDetail.mockReturnValue({ section: null });
    const { queryByTestId } = render(<SectionPRContent insight={insight('section_pr')} />);
    expect(queryByTestId('section-read-failure')).toBeNull();
  });
});

describe('RouteOverlayPicker', () => {
  it('shows the failure instead of "no saved routes"', () => {
    const { getByTestId, queryByText } = render(
      <RouteOverlayPicker
        visible
        activityType="Ride"
        selectedRouteId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByTestId('route-groups-failure').props.children).toBe('engine.failure.database');
    expect(queryByText('No saved routes for this sport yet.')).toBeNull();
  });
});

describe('route hooks hand the failure on', () => {
  it('useRouteGroups returns the error of its summaries read', () => {
    const { result } = renderHook(() => useRouteGroups());
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });
});

describe('StrengthActivityCard', () => {
  it('says the muscles could not be read rather than drawing none', () => {
    const { getByTestId } = render(
      <StrengthActivityCard
        activity={
          {
            id: 'a1',
            type: 'WeightTraining',
            name: 'Lift',
            start_date_local: '2026-01-01T08:00:00',
            moving_time: 3600,
          } as Activity
        }
        strengthData={{
          muscles: [],
          musclesError: lockFailed,
          exerciseCount: 1,
          setCount: 3,
          totalWeight: 0,
        }}
      />
    );
    expect(getByTestId('muscle-groups-failure').props.children).toBe('engine.failure.database');
  });
});
