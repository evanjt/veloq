/**
 * Scenario: the athlete follows a saved route on the record screen.
 *
 * Expected behaviour: a chip names the route with its length and best time, a route without a
 * best time shows no time at all, and its close control stops following in one press.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FollowedRouteChip } from '@/features/recording/components/FollowedRouteChip';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const lakeLoop = { name: 'Lake loop', distanceMeters: 12_400, bestTimeSeconds: 2_482 };

describe('FollowedRouteChip', () => {
  it('says which route is followed with its distance and best time', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);

    expect(screen.getByTestId('followed-route-title').props.children).toContain('Lake loop');
    const detail = screen.getByTestId('followed-route-detail').props.children;
    expect(detail).toContain('12.4 km');
    expect(detail).toContain('41:22');
  });

  it('shows no best time for a route without one, not 0:00', () => {
    render(<FollowedRouteChip route={{ ...lakeLoop, bestTimeSeconds: null }} onStop={jest.fn()} />);

    const detail = screen.getByTestId('followed-route-detail').props.children;
    expect(detail).toBe('12.4 km');
    expect(detail).not.toContain('0:00');
  });

  it('stops following in one press', () => {
    const onStop = jest.fn();
    render(<FollowedRouteChip route={lakeLoop} onStop={onStop} />);

    fireEvent.press(screen.getByTestId('followed-route-dismiss'));

    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
