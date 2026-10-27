/**
 * Scenario: intervals.icu holds an activity but does not serve it to apps, and
 * the engine reports that on the activity's detail read.
 *
 * Expected behaviour: the ride reads "Not shared by intervals.icu" in an empty
 * state. A Garmin import offers Connect Garmin, which opens the connector, and
 * any other source offers no action.
 */

import React from 'react';
import { configure, fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityHeldBackNotice } from '@/features/activity/components/ActivityHeldBack';
import { navigateTo } from '@/shared/app/navigation';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

describe('ActivityHeldBackNotice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDebugStore.setState({ experimentalEnabled: true, experimentalFeatures: {} });
  });

  it("names no Garmin and offers no connector while Garmin's experimental switch is off", () => {
    useDebugStore.setState({ experimentalEnabled: false });
    render(
      <ActivityHeldBackNotice
        activityId="h1"
        heldBack={{ source: 'GARMIN_CONNECT', externalId: '5550001' }}
      />
    );
    expect(screen.getByTestId('activity-h1-held-back-description').props.children).toBe(
      'activity.heldBack.detail'
    );
    expect(screen.queryByTestId('activity-h1-held-back-connect-garmin')).toBeNull();
  });

  it('shows the empty state with Connect Garmin for a Garmin import', () => {
    render(
      <ActivityHeldBackNotice
        activityId="h1"
        heldBack={{ source: 'GARMIN_CONNECT', externalId: '5550001' }}
      />
    );
    expect(screen.getByTestId('activity-h1-held-back')).toBeTruthy();
    expect(screen.getByTestId('activity-h1-held-back-title').props.children).toBe(
      'activity.heldBack.title'
    );
    expect(screen.getByTestId('activity-h1-held-back-description').props.children).toBe(
      'activity.heldBack.detailGarmin'
    );
    expect(screen.getByText('activity.heldBack.connectGarmin')).toBeTruthy();
  });

  it('opens the Garmin connector from Connect Garmin', () => {
    render(
      <ActivityHeldBackNotice
        activityId="h1"
        heldBack={{ source: 'GARMIN_CONNECT', externalId: '5550001' }}
      />
    );
    fireEvent.press(screen.getByTestId('activity-h1-held-back-connect-garmin'));
    expect(navigateTo).toHaveBeenCalledWith('/garmin-connector');
  });

  it('shows the intervals.icu description and no action for another source', () => {
    render(
      <ActivityHeldBackNotice activityId="h2" heldBack={{ source: 'STRAVA', externalId: '9' }} />
    );
    expect(screen.getByTestId('activity-h2-held-back-description').props.children).toBe(
      'activity.heldBack.detail'
    );
    expect(screen.queryByText('activity.heldBack.connectGarmin')).toBeNull();
    expect(screen.queryByTestId('activity-h2-held-back-connect-garmin')).toBeNull();
  });
});
