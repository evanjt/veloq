/**
 * Scenario: a section's pass count was printed as visits on some surfaces, as a bare '×'
 * on others and as traversals on the rest, and a route's activity count as attempts.
 *
 * Expected behaviour: every surface counts a section in traversals and a route in
 * activities, and no locale still carries the retired visit and attempt keys.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { loadableLocales } from '@/i18n/localeBundles';
import { SectionPopup } from '@/features/maps/components/regional/SectionPopup';
import { RouteInsightContent } from '@/features/insights/components/content/RouteInsightContent';
import type { FrequentSection, Insight } from '@/types';

import { resolvedLocale } from './resolvedLocale';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

describe('section pass counts', () => {
  it('the map popup counts a section in traversals', async () => {
    const section = {
      id: 'quarry',
      sectionType: 'auto',
      name: 'Quarry climb',
      sportTypes: ['Run'],
      polyline: [],
      distanceMeters: 1200,
      activityIds: ['a1'],
      visitCount: 34,
      createdAt: '2026-01-01T00:00:00Z',
    } as FrequentSection;
    await render(<SectionPopup section={section} bottom={0} onClose={jest.fn()} />);
    expect(screen.getByText(/34 traversals/)).toBeTruthy();
    expect(screen.queryByText(/visits?\b/)).toBeNull();
  });

  it('counts one pass in the singular', async () => {
    const section = {
      id: 'ford',
      sectionType: 'auto',
      name: 'Ford lane',
      sportTypes: ['Ride'],
      polyline: [],
      distanceMeters: 400,
      activityIds: ['a1'],
      visitCount: 1,
      createdAt: '2026-01-01T00:00:00Z',
    } as FrequentSection;
    await render(<SectionPopup section={section} bottom={0} onClose={jest.fn()} />);
    expect(screen.getByText(/1 traversal\b/)).toBeTruthy();
  });
});

describe('route pass counts', () => {
  it('the route insight sheet counts a route in activities', async () => {
    const insight = {
      id: 'r1',
      category: 'route_trend',
      priority: 1,
      title: 'Routes',
      icon: 'map-marker-path',
      iconTone: 'neutral',
      timestamp: 0,
      isNew: false,
      supportingData: {
        routes: [
          {
            rowKey: 'canal:Ride',
            routeId: 'canal',
            routeName: 'Canal loop',
            sportType: 'Ride',
            isRecentRecord: false,
            trend: 0,
            bestTime: 1800,
            daysSinceLast: 3,
            attemptCount: 7,
            recentEfforts: [],
            navigationTarget: '/route/canal',
          },
        ],
      },
    } as unknown as Insight;
    await render(<RouteInsightContent insight={insight} />);
    expect(screen.getByText(/7 activities/)).toBeTruthy();
    expect(screen.queryByText(/attempts?\b/)).toBeNull();
  });
});

describe('retired count keys', () => {
  it.each(loadableLocales())('%s carries no visit or attempt count', (locale) => {
    const bundle = resolvedLocale(locale) as unknown as Record<string, Record<string, unknown>>;
    const keys = (group: Record<string, unknown> | undefined) => Object.keys(group ?? {});
    expect(keys(bundle.sections).filter((k) => k.startsWith('visitsCount'))).toEqual([]);
    const route = (bundle.insights as Record<string, Record<string, unknown>> | undefined)?.route;
    expect(keys(route).filter((k) => k.startsWith('attempts'))).toEqual([]);
  });
});
