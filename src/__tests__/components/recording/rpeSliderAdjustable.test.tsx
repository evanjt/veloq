/**
 * Scenario: the effort control on a finished strength session, reached by a
 * screen reader, a switch or a finger that lands on the thumb.
 *
 * Expected behaviour: the track is one adjustable element that names its value
 * and band, steps by one inside 1 to 10, draws its value text in an ink rather
 * than in the band hue, and follows a drag by how far the finger moved, so a
 * nudge from the thumb stays near where it started.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { RpeSlider } from '@/features/recording/components/RpeSlider';
import { colors, zoneColour } from '@/theme';
import { rpeZone } from '@/features/recording/lib/rpeZone';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const TRACK_WIDTH = 270;

async function renderSlider(value: number) {
  const onValueChange = jest.fn();
  await render(
    <RpeSlider value={value} onValueChange={onValueChange} textSecondary={colors.textSecondary} />
  );
  const track = screen.getByRole('adjustable');
  await fireEvent(track, 'layout', { nativeEvent: { layout: { width: TRACK_WIDTH, height: 32 } } });
  return { onValueChange, track };
}

async function stepAction(track: ReactTestInstance, actionName: 'increment' | 'decrement') {
  await fireEvent(track, 'accessibilityAction', { nativeEvent: { actionName } });
}

/** One touch's responder event, as the touch system reports it at `pageX`. */
function touch(pageX: number, locationX: number, timeStamp: number, startPageX: number) {
  return {
    nativeEvent: { pageX, locationX, pageY: 0, locationY: 16, timestamp: timeStamp },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timeStamp,
      touchBank: [
        {
          touchActive: true,
          startPageX,
          startPageY: 0,
          startTimeStamp: 0,
          currentPageX: pageX,
          currentPageY: 0,
          currentTimeStamp: timeStamp,
          previousPageX: startPageX,
          previousPageY: 0,
          previousTimeStamp: 0,
        },
      ],
    },
  };
}

describe('RpeSlider', () => {
  it('is one adjustable element naming its value and band', async () => {
    const { track } = await renderSlider(7);
    expect(track.props.accessibilityLabel).toBe('recording.rpe');
    expect(track.props.accessibilityValue).toEqual(
      expect.objectContaining({ min: 1, max: 10, now: 7 })
    );
    expect(track.props.accessibilityValue.text).toContain('7');
    expect(track.props.accessibilityValue.text).toContain('recording.rpeLabels.veryHard');
  });

  it('steps up and down by one', async () => {
    const { onValueChange, track } = await renderSlider(7);
    await stepAction(track, 'increment');
    expect(onValueChange).toHaveBeenLastCalledWith(8);
    await stepAction(track, 'decrement');
    expect(onValueChange).toHaveBeenLastCalledWith(6);
  });

  it('stays at 10 when stepped past the top and at 1 past the bottom', async () => {
    const top = await renderSlider(10);
    await stepAction(top.track, 'increment');
    expect(top.onValueChange).not.toHaveBeenCalled();
    await screen.unmount();

    const bottom = await renderSlider(1);
    await stepAction(bottom.track, 'decrement');
    expect(bottom.onValueChange).not.toHaveBeenCalled();
  });

  it('draws the value text in an ink, never in its zone colour', async () => {
    for (const value of [1, 3, 5, 7, 10]) {
      await renderSlider(value);
      const text = screen.getByText(new RegExp(`^${value} - recording\\.rpeLabels`));
      const color = StyleSheet.flatten(text.props.style).color;
      expect(color).not.toBe(zoneColour(rpeZone(value), false));
      expect(color).toBe(colors.textPrimary);
      await screen.unmount();
    }
  });

  it('follows a drag that starts on the thumb by how far the finger moved', async () => {
    const { onValueChange, track } = await renderSlider(7);
    // The thumb at 7 sits two thirds along the track. The touch system may
    // report later positions relative to whichever view is under the finger,
    // here the 28 dp thumb, so a 30 dp nudge right reads as a small locationX.
    const trackPageX = 40;
    const startX = (6 / 9) * TRACK_WIDTH;
    const start = trackPageX + startX;
    await fireEvent(track, 'responderGrant', touch(start, startX, 1, start));
    await fireEvent(track, 'responderMove', touch(start + 30, 18, 2, start));
    await fireEvent(track, 'responderRelease', touch(start + 30, 18, 3, start));
    expect(onValueChange).toHaveBeenLastCalledWith(8);
  });
});
