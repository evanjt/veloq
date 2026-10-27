/**
 * Scenario: the feed holds a stub intervals.icu does not serve, with the
 * engine's verdict on its card.
 *
 * Expected behaviour: a Garmin stub with a key offers the update and asks
 * before running it, one without a key points at the connector, a stub from
 * another source carries a plain line, a served card carries nothing, and
 * with the experimental switch off none of them draws.
 */

import React from 'react';
import { configure, fireEvent, render, screen } from '@testing-library/react-native';
import { StubVerdict } from 'veloqrs';

import { ActivityStubAction } from '@/features/activity/components/ActivityStubAction';
import { navigateTo } from '@/shared/app/navigation';
import { confirmAction } from '@/shared/ui/dialog';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));
jest.mock('@/shared/native/garminSwap', () => ({
  garminSwapState: jest.fn(),
  garminSwapReplace: jest.fn(),
  garminSwapUndo: jest.fn(),
}));
jest.mock('@/shared/ui/dialog', () => ({ confirmAction: jest.fn() }));
jest.mock('@/features/recording', () => ({
  useWriteAccessMissing: () => false,
  usePermissionUpgrade: () => ({
    upgradePermissions: jest.fn(),
    isUpgrading: false,
    error: null,
  }),
}));

const garminState = require('@/shared/native/garminSwap').garminSwapState as jest.Mock;

const draw = (verdict: StubVerdict) =>
  render(<ActivityStubAction activityId="a1" verdict={verdict} />);

beforeEach(() => {
  jest.clearAllMocks();
  useDebugStore.setState({
    experimentalEnabled: true,
    experimentalFeatures: { garminUpdate: true },
  });
});

it('offers the update for a Garmin stub, asks first, and reads no state to draw it', async () => {
  await draw(StubVerdict.GarminUpdatable);
  fireEvent.press(screen.getByText('activity.stubCard.update'));
  await screen.findByTestId('activity-card-a1-stub-update');
  expect(confirmAction).toHaveBeenCalledTimes(1);
  expect(garminState).not.toHaveBeenCalled();
});

it('points a stub with no key at the connector', async () => {
  await draw(StubVerdict.NoKey);
  fireEvent.press(screen.getByText('activity.stubCard.noKey'));
  expect(navigateTo).toHaveBeenCalledWith('/garmin-connector');
  expect(screen.queryByText('activity.stubCard.update')).toBeNull();
});

it('draws a plain line with no action for a stub from another source', async () => {
  await draw(StubVerdict.OtherSource);
  expect(screen.getByText('activity.stubCard.otherSource')).toBeTruthy();
  expect(screen.queryByText('activity.stubCard.update')).toBeNull();
  expect(screen.queryByTestId('activity-card-a1-stub-connect')).toBeNull();
});

it('draws nothing for a served card', async () => {
  await draw(StubVerdict.NotStub);
  expect(screen.toJSON()).toBeNull();
});

it('draws nothing while the experimental switch is off', async () => {
  useDebugStore.setState({ experimentalEnabled: false });
  await draw(StubVerdict.GarminUpdatable);
  expect(screen.toJSON()).toBeNull();
});
