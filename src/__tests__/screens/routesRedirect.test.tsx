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

jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn() }));
jest.mock('@/shared/app/navigation', () => ({ replaceTo: jest.fn() }));

function renderWith(params: Record<string, string | undefined>) {
  (useLocalSearchParams as jest.Mock).mockReturnValue(params);
  render(<RoutesRedirectScreen />);
}

beforeEach(() => jest.clearAllMocks());

it('sends a bare /routes to the insights tab', () => {
  renderWith({});
  expect(replaceTo).toHaveBeenCalledWith({ pathname: '/insights', params: {} });
});

it('carries the sub-tab through', () => {
  renderWith({ tab: 'sections' });
  expect(replaceTo).toHaveBeenCalledWith({
    pathname: '/insights',
    params: { tab: 'sections' },
  });
});

it('carries an insight id through', () => {
  renderWith({ tab: 'insights', insightId: 'ins-7' });
  expect(replaceTo).toHaveBeenCalledWith({
    pathname: '/insights',
    params: { tab: 'insights', insightId: 'ins-7' },
  });
});

it('redirects once, not on every render', () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ tab: 'routes' });
  const { rerender } = render(<RoutesRedirectScreen />);
  rerender(<RoutesRedirectScreen />);
  expect(replaceTo).toHaveBeenCalledTimes(1);
});
