/**
 * Scenario: a screen reader user taps an activity, section or route on the map.
 * Expected behaviour: focus moves to the popup's title once it has laid out, so
 * its actions are reached by swiping on from there rather than by sweeping the
 * whole screen; a different item moves it again, a re-render does not.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';

import {
  ActivityPopup,
  type SelectedActivity,
} from '@/features/maps/components/regional/ActivityPopup';
import { SectionPopup } from '@/features/maps/components/regional/SectionPopup';
import { RoutePopup } from '@/features/maps/components/regional/RoutePopup';
import type { FrequentSection } from '@/types';

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

const focus = AccessibilityInfo.setAccessibilityFocus as jest.Mock;

// The test renderer has no native tags, so a view's testID stands in for its handle.
beforeEach(() => {
  jest.useFakeTimers();
  focus.mockClear();
  jest
    .spyOn(require('react-native'), 'findNodeHandle', 'get')
    .mockReturnValue(
      (instance: { props?: { testID?: string } } | null) => instance?.props?.testID ?? null
    );
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function settle() {
  await act(() => {
    jest.runOnlyPendingTimers();
  });
}

function activity(id: string, name: string): SelectedActivity {
  return {
    activity: {
      id,
      bounds: [
        [46.1, 7.1],
        [46.2, 7.2],
      ],
      type: 'Ride',
      name,
      date: '2026-10-01T09:00:00Z',
      distance: 12000,
      duration: 1800,
    },
    mapData: null,
    isLoading: false,
  };
}

function activityPopup(selected: SelectedActivity | null) {
  return (
    <ActivityPopup
      selected={selected}
      bottom={0}
      onZoom={jest.fn()}
      onClose={jest.fn()}
      onViewDetails={jest.fn()}
    />
  );
}

function section(id: string): FrequentSection {
  return {
    id,
    sectionType: 'auto',
    name: 'Quarry climb',
    sportTypes: ['Run'],
    polyline: [],
    distanceMeters: 1200,
    activityIds: ['a1'],
    visitCount: 2,
    createdAt: '2026-01-01T00:00:00Z',
  } as FrequentSection;
}

describe('activity popup focus', () => {
  it('moves focus to the title once, after the popup has laid out', async () => {
    const view = await render(activityPopup(activity('lantern-walk', 'Lantern walk')));
    expect(focus).not.toHaveBeenCalled();

    await settle();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith('activity-popup-title');

    await view.rerender(activityPopup(activity('lantern-walk', 'Lantern walk')));
    await settle();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('moves focus again for another activity, even one with the same name', async () => {
    const view = await render(activityPopup(activity('lantern-walk', 'Lantern walk')));
    await settle();
    await view.rerender(activityPopup(activity('lantern-walk-2', 'Lantern walk')));
    await settle();
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('moves nothing while no activity is selected, and focuses on the next selection', async () => {
    const view = await render(activityPopup(null));
    await settle();
    expect(focus).not.toHaveBeenCalled();

    await view.rerender(activityPopup(activity('lantern-walk', 'Lantern walk')));
    await settle();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not move focus when the popup closes before it has laid out', async () => {
    const view = await render(activityPopup(activity('lantern-walk', 'Lantern walk')));
    await view.rerender(activityPopup(null));
    await settle();
    expect(focus).not.toHaveBeenCalled();
  });
});

describe('section and route popup focus', () => {
  it('moves focus to the section title, and again for another section', async () => {
    const view = await render(
      <SectionPopup section={section('quarry')} bottom={0} onClose={jest.fn()} />
    );
    await settle();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith('section-popup-title');

    await view.rerender(
      <SectionPopup section={section('quarry')} bottom={0} onClose={jest.fn()} />
    );
    await settle();
    expect(focus).toHaveBeenCalledTimes(1);

    await view.rerender(<SectionPopup section={section('ridge')} bottom={0} onClose={jest.fn()} />);
    await settle();
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('moves focus to the route title', async () => {
    await render(
      <RoutePopup
        route={{ routeId: 'canal-loop', name: 'Canal loop', activityCount: 4 }}
        bottom={0}
        onClose={jest.fn()}
        onViewDetails={jest.fn()}
      />
    );
    await settle();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith('route-popup-title');
  });
});
