/**
 * Scenario: the Insights tab used to live at `/routes`, and notifications
 * scheduled before the rename still carry that path.
 * Expected behaviour: `/routes` lands on `/insights` with its query intact.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import RoutesRedirectScreen from '@/app/routes';
import { replaceTo } from '@/shared/app/navigation';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@/shared/app/navigation', () => ({ replaceTo: jest.fn() }));

async function renderWith(params: Record<string, string | undefined>) {
  (useLocalSearchParams as jest.Mock).mockReturnValue(params);
  await render(<RoutesRedirectScreen />);
}

beforeEach(() => jest.clearAllMocks());

it('sends a bare /routes to the insights tab', async () => {
  await renderWith({});
  expect(replaceTo).toHaveBeenCalledWith({ pathname: '/insights', params: {} });
});

it('carries the sub-tab through', async () => {
  await renderWith({ tab: 'sections' });
  expect(replaceTo).toHaveBeenCalledWith({
    pathname: '/insights',
    params: { tab: 'sections' },
  });
});

it('carries an insight id through', async () => {
  await renderWith({ tab: 'insights', insightId: 'ins-7' });
  expect(replaceTo).toHaveBeenCalledWith({
    pathname: '/insights',
    params: { tab: 'insights', insightId: 'ins-7' },
  });
});

it('redirects once, not on every render', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ tab: 'routes' });
  const { rerender } = await render(<RoutesRedirectScreen />);
  await rerender(<RoutesRedirectScreen />);
  expect(replaceTo).toHaveBeenCalledTimes(1);
});
