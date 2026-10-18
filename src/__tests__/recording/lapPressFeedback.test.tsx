/**
 * Scenario: an athlete presses Lap with the phone on a mount in sunlight, or with gloves on. A
 * haptic alone cannot tell a lap that registered from a press that missed.
 *
 * Expected behaviour: a lap press shows and announces "Lap n · m:ss" for a few seconds, above
 * any standing warning. Lap, Pause, Resume, Start and Finish tick, since a finished ride can be
 * resumed from review, a manual save fires the success pattern, nothing fires the strong
 * impact, and Review, which only opens the next screen, fires nothing.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ControlBar } from '@/features/recording/components/ControlBar';
import { StatusSlot } from '@/features/recording/components/StatusSlot';
import { useLapBanner } from '@/features/recording/hooks/useLapBanner';
import { useRecordingHandlers } from '@/features/recording/hooks/useRecordingHandlers';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import * as haptics from '@/shared/ui/haptics';
import { i18n, initialiseI18n } from '@/i18n';

jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/shared/ui/haptics');

const noop = () => {};

function LiveScreen({ gpsWarning = null }: { gpsWarning?: string | null }) {
  const lapBanner = useLapBanner();
  const { handleLap, handlePause, handleResume } = useRecordingHandlers();
  const status = useRecordingStore((s) => s.status);
  return (
    <>
      <StatusSlot
        backgroundTrackingWarning={null}
        gpsWarning={gpsWarning}
        sensorIssue={null}
        splitBanner={null}
        lapBanner={lapBanner}
        onDismissGpsWarning={noop}
      />
      <ControlBar
        status={status}
        mode="gps"
        onLap={handleLap}
        onPause={handlePause}
        onResume={handleResume}
        onStart={noop}
        onStop={noop}
        onReview={noop}
      />
    </>
  );
}

async function advance(ms: number) {
  await act(() => jest.advanceTimersByTime(ms));
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-03-01T08:00:00Z') });
  jest.clearAllMocks();
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a lap press', () => {
  it('shows and announces the lap with its time, then clears', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<LiveScreen />);

    await advance(83_000);
    await fireEvent.press(screen.getByTestId('control-lap'));

    const first = i18n.t('recording.lapBanner', { n: 1, time: '1:23' });
    expect(first).toBe('Lap 1 · 1:23');
    expect(screen.getByText(first)).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(first);

    await advance(4_000);
    expect(screen.queryByText(first)).toBeNull();
  });

  it('times the second lap from the first', async () => {
    await render(<LiveScreen />);

    await advance(60_000);
    await fireEvent.press(screen.getByTestId('control-lap'));
    await advance(1_000);
    await fireEvent.press(screen.getByTestId('control-lap'));

    expect(screen.queryByText('Lap 1 · 1:00')).toBeNull();
    expect(screen.getByText('Lap 2 · 0:01')).toBeTruthy();
  });

  it('shows over a standing GPS warning, which returns once the lap clears', async () => {
    await render(<LiveScreen gpsWarning="Weak signal" />);
    expect(screen.getByText('Weak signal')).toBeTruthy();

    await advance(5_000);
    await fireEvent.press(screen.getByTestId('control-lap'));
    expect(screen.getByText('Lap 1 · 0:05')).toBeTruthy();

    await advance(4_000);
    expect(screen.getByText('Weak signal')).toBeTruthy();
  });

  it('does not announce laps already taken when the screen mounts', async () => {
    await advance(10_000);
    await act(() => useRecordingStore.getState().addLap());
    await render(<LiveScreen />);

    expect(screen.queryByText('Lap 1 · 0:10')).toBeNull();
  });

  it('shows nothing for a press the store refuses, while paused', async () => {
    await act(() => useRecordingStore.getState().pauseRecording());
    await render(<LiveScreen />);
    await act(() => useRecordingStore.getState().addLap());

    expect(screen.queryByTestId('status-slot-lap')).toBeNull();
  });
});

describe('the bar haptics', () => {
  const bar = {
    mode: 'gps' as const,
    onLap: noop,
    onPause: noop,
    onResume: noop,
    onStart: noop,
    onStop: noop,
    onReview: noop,
  };

  async function press(status: 'idle' | 'recording' | 'paused' | 'stopped', testID: string) {
    jest.clearAllMocks();
    const view = await render(<ControlBar {...bar} status={status} />);
    await fireEvent.press(view.getByTestId(testID));
    view.unmount();
  }

  it.each([
    ['recording', 'control-lap'],
    ['recording', 'control-pause'],
    ['paused', 'control-resume'],
    ['idle', 'control-start'],
    ['recording', 'control-stop'],
    ['paused', 'control-stop'],
  ] as const)('ticks for a change of state, %s %s', async (status, testID) => {
    await press(status, testID);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    expect(haptics.medium).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('fires the success pattern for a manual save, which commits the entry', async () => {
    jest.clearAllMocks();
    const view = await render(<ControlBar {...bar} mode="manual" status="idle" />);
    await fireEvent.press(view.getByTestId('control-save'));
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(haptics.medium).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('fires nothing for Review, which only opens the next screen', async () => {
    await press('stopped', 'control-review');
    expect(haptics.medium).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.light).not.toHaveBeenCalled();
  });
});
