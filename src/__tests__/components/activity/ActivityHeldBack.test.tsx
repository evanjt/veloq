/**
 * Scenario: intervals.icu holds an activity but does not serve it to apps, and
 * the engine reports that on the activity's detail read.
 *
 * Expected behaviour: the notice says intervals.icu holds it, a Garmin import
 * also says connecting Garmin fills it, and any other source does not.
 */

import React from 'react';
import { configure, render, screen } from '@testing-library/react-native';

import { ActivityHeldBackNotice } from '@/features/activity/components/ActivityHeldBack';

configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

describe('ActivityHeldBackNotice', () => {
  it('names the hold and offers the Garmin connection for a Garmin import', () => {
    render(
      <ActivityHeldBackNotice
        activityId="h1"
        heldBack={{ source: 'GARMIN_CONNECT', externalId: '24686966034' }}
      />
    );
    expect(screen.getByTestId('activity-h1-held-back')).toBeTruthy();
    expect(screen.getByText('activity.heldBack.title')).toBeTruthy();
    expect(screen.getByText('activity.heldBack.detail')).toBeTruthy();
    expect(screen.getByText('activity.heldBack.detailGarmin')).toBeTruthy();
  });

  it('does not offer the Garmin connection for another source', () => {
    render(
      <ActivityHeldBackNotice activityId="h2" heldBack={{ source: 'STRAVA', externalId: '9' }} />
    );
    expect(screen.getByText('activity.heldBack.detail')).toBeTruthy();
    expect(screen.queryByText('activity.heldBack.detailGarmin')).toBeNull();
  });
});
