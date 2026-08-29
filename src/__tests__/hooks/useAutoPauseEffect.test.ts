/**
 * Scenario: a ride auto-pauses at a traffic light, then the rider sets off again.
 *
 * Expected behaviour: the detector keeps seeing speed while paused, because raw
 * location fixes are published whether or not the point is recorded, so the
 * resume branch fires. Driving it from `streams.speed` could never resume: the
 * stream stops growing the moment `addGpsPoint` starts refusing.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useAutoPauseEffect } from '@/features/recording/hooks/useAutoPauseEffect';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

// One fix per second, moving north from a fixed origin at the given speed.
function fixAt(secondsIn: number, metresNorth: number) {
  return {
    latitude: 47.5 + metresNorth / 111_320,
    longitude: 8.5,
    altitude: 400,
    accuracy: 5,
    speed: null,
    heading: null,
    timestamp: 1_700_000_000_000 + secondsIn * 1000,
  };
}

function pushFix(secondsIn: number, metresNorth: number) {
  act(() => {
    useRecordingStore.getState().setRawLocationFix(fixAt(secondsIn, metresNorth));
  });
}

describe('useAutoPauseEffect', () => {
  beforeEach(() => {
    useRecordingStore.getState().reset();
    useRecordingPreferences.setState({
      autoPauseEnabled: true,
      autoPauseThresholds: { cycling: 3.6 }, // 1 m/s
      autoPauseDurationMs: 5000,
    });
  });

  function mount() {
    const setAutoPaused = jest.fn();
    const view = renderHook(
      ({ status, autoPaused }: { status: 'recording' | 'paused'; autoPaused: boolean }) =>
        useAutoPauseEffect({
          activityType: 'Ride',
          mode: 'gps',
          status,
          autoPaused,
          setAutoPaused,
        }),
      { initialProps: { status: 'recording' as const, autoPaused: false } }
    );
    return { ...view, setAutoPaused };
  }

  it('pauses after the stationary duration and resumes when moving again', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    const { rerender, setAutoPaused } = mount();

    let metres = 0;
    for (let second = 0; second <= 3; second++) pushFix(second, (metres += 10));
    expect(setAutoPaused).not.toHaveBeenCalled();

    // Stationary: same position, so derived speed is 0.
    for (let second = 4; second <= 10; second++) pushFix(second, metres);
    expect(setAutoPaused).toHaveBeenCalledWith(true);
    expect(useRecordingStore.getState().status).toBe('paused');

    rerender({ status: 'paused', autoPaused: true });

    // Rolling again, well above the resume hysteresis.
    for (let second = 11; second <= 13; second++) pushFix(second, (metres += 10));

    expect(setAutoPaused).toHaveBeenLastCalledWith(false);
    expect(useRecordingStore.getState().status).toBe('recording');
  });

  it('publishes raw speed while paused, when addGpsPoint refuses the point', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    pushFix(0, 0);
    act(() => useRecordingStore.getState().pauseRecording());

    pushFix(1, 10);

    expect(useRecordingStore.getState().streams.speed).toHaveLength(0);
    expect(useRecordingStore.getState().rawSpeed?.value).toBeCloseTo(10, 1);
  });
});
