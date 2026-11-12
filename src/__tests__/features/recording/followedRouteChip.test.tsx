/**
 * Scenario: the athlete follows a saved route on the record screen.
 *
 * Expected behaviour: a chip names the route with its length and best time, a route without a
 * best time shows no time at all, and its close control stops following in one press.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FfiFollowDirection, FfiFollowStatus } from 'veloqrs';

import { FollowedRouteChip } from '@/features/recording/components/FollowedRouteChip';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import * as haptics from '@/shared/ui/haptics';
import { colors } from '@/theme';

jest.mock('@/shared/ui/haptics', () => ({ medium: jest.fn() }));

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

describe('FollowedRouteChip guidance', () => {
  const record = (over: Record<string, unknown>) => ({
    alongM: 0,
    remainingM: 12_400,
    crossTrackM: 5,
    routeBearingDeg: 0,
    bearingToRouteDeg: 0,
    status: FfiFollowStatus.OnRoute,
    direction: FfiFollowDirection.Forward,
    ...over,
  });
  const give = (over: Record<string, unknown>, heading: number | null = null) =>
    act(() => useRecordingLiveStore.setState({ guidance: record(over) as never, heading }));
  const title = () => screen.getByTestId('followed-route-title').props;
  const detail = () => screen.getByTestId('followed-route-detail').props.children as string;
  const warning = colors.warningText;

  beforeEach(() => {
    useRecordingLiveStore.getState().reset();
    jest.mocked(haptics.medium).mockClear();
  });

  it('reads the distance left and keeps the best time while on the route', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({ remainingM: 12_400 });

    expect(detail()).toContain('recording.guidance.remaining');
    expect(detail()).toContain('12.4 km');
    expect(detail()).toContain('41:22');
  });

  it('keeps the whole route length while the direction is undecided', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({ remainingM: 3_000, direction: FfiFollowDirection.Undecided });

    expect(detail()).toContain('12.4 km');
    expect(detail()).not.toContain('3 km');
  });

  it('says how far away the route is before it is joined, without a warning tone', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({ status: FfiFollowStatus.NotJoined, crossTrackM: 350 });

    expect(detail()).toContain('recording.guidance.notJoined');
    expect(detail()).toContain('350 m');
    expect(JSON.stringify(title().style)).not.toContain(warning);
    expect(screen.queryByTestId('followed-route-arrow')).toBeNull();
  });

  it('warns off route with an arrow turned to the route, relative to the heading', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({ status: FfiFollowStatus.OffRoute, crossTrackM: 140, bearingToRouteDeg: 90 }, 0);

    expect(title().children).toContain('recording.guidance.offRoute');
    expect(title().children).toContain('140 m');
    expect(JSON.stringify(title().style)).toContain(warning);
    expect(screen.getByTestId('followed-route-arrow').props.style).toMatchObject({
      transform: [{ rotate: '90deg' }],
    });

    give({ status: FfiFollowStatus.OffRoute, crossTrackM: 140, bearingToRouteDeg: 90 }, 90);
    expect(screen.getByTestId('followed-route-arrow').props.style).toMatchObject({
      transform: [{ rotate: '0deg' }],
    });
  });

  it('turns the arrow against north when the heading is unknown', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({ status: FfiFollowStatus.OffRoute, crossTrackM: 140, bearingToRouteDeg: 270 }, null);

    expect(screen.getByTestId('followed-route-arrow').props.style).toMatchObject({
      transform: [{ rotate: '270deg' }],
    });
  });

  it('fires one medium haptic on entering off route and none on leaving', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    const off = { status: FfiFollowStatus.OffRoute, crossTrackM: 140, bearingToRouteDeg: 90 };
    give(off);
    give({ ...off, crossTrackM: 150 });
    give({ ...off, crossTrackM: 160 });
    expect(haptics.medium).toHaveBeenCalledTimes(1);

    give({ status: FfiFollowStatus.OnRoute });
    expect(haptics.medium).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('followed-route-arrow')).toBeNull();
    expect(JSON.stringify(title().style)).not.toContain(warning);
    expect(title().children).toContain('Lake loop');
  });

  it('cues a turn within 150 m, left or right, ahead of the length left', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({ nextTurn: { alongM: 900, distanceM: 50, angleDeg: -90 } });

    expect(detail()).toContain('recording.guidance.turnLeft');
    expect(detail()).toContain('50 m');
    expect(detail().indexOf('turnLeft')).toBeLessThan(
      detail().indexOf('recording.guidance.remaining')
    );
    expect(screen.getByTestId('followed-route-turn')).toBeTruthy();

    give({ nextTurn: { alongM: 900, distanceM: 50, angleDeg: 90 } });
    expect(detail()).toContain('recording.guidance.turnRight');
  });

  it('cues a turn back on a hairpin', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({ nextTurn: { alongM: 900, distanceM: 50, angleDeg: 170 } });

    expect(detail()).toContain('recording.guidance.turnBack');
    expect(detail()).not.toContain('recording.guidance.turnRight');
  });

  it('shows no turn 400 m ahead, only the distance left', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({ nextTurn: { alongM: 900, distanceM: 400, angleDeg: -90 } });

    expect(detail()).not.toContain('recording.guidance.turn');
    expect(screen.queryByTestId('followed-route-turn')).toBeNull();
    expect(detail()).toContain('12.4 km');
  });

  it('shows no turn while off route, even with a next turn held', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);
    give({
      status: FfiFollowStatus.OffRoute,
      crossTrackM: 140,
      bearingToRouteDeg: 90,
      nextTurn: { alongM: 900, distanceM: 50, angleDeg: -90 },
    });

    expect(detail()).not.toContain('recording.guidance.turn');
    expect(screen.queryByTestId('followed-route-turn')).toBeNull();
    expect(screen.getByTestId('followed-route-arrow')).toBeTruthy();
  });

  it('shows the chip as before when there is no guidance', () => {
    render(<FollowedRouteChip route={lakeLoop} onStop={jest.fn()} />);

    expect(detail()).toBe('12.4 km · recording.routeOverlay.pr:{"time":"41:22"}');
    expect(screen.queryByTestId('followed-route-arrow')).toBeNull();
  });
});
