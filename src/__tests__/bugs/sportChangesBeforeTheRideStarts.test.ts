/**
 * Scenario: the sport can be changed at any time, before, during or after the
 * recording, so a wrong pick never costs the ride. Before was the one moment
 * that did not work: `changeActivityType` returned early while the status was
 * `idle`, and a one-tap entry is idle on the recording screen.
 *
 * Expected behaviour: a tap on the Ride widget that the athlete meant as Run
 * can be corrected before Start is pressed, and the ride that then starts
 * is a Run.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { screenRecordingMode } from '@/features/recording/lib/recordingModes';
import type { ActivityType } from '@/features/activity';

const started = () => useRecordingStore.getState().startRecording as jest.Mock;
// A spy on the state object is copied into every later state, so restoring
// mocks does not bring the real action back. It is put back by hand.
const realStartRecording = useRecordingStore.getState().startRecording;

beforeEach(() => {
  jest.useFakeTimers();
  useRecordingStore.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the sport before the ride starts', () => {
  it('changes while the store is idle, which is every moment before a start', () => {
    useRecordingStore.getState().changeActivityType('Run');
    expect(useRecordingStore.getState().activityType).toBe('Run');
  });

  it('still changes on a stopped recording, which the review screen re-picks from', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();
    useRecordingStore.getState().changeActivityType('Run');
    expect(useRecordingStore.getState().activityType).toBe('Run');
  });

  describe('with a one-tap entry idle', () => {
    const idle = () =>
      renderHook(() => useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart'));

    it('starts the sport chosen on the screen, not the one tapped', () => {
      jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
      const { result } = idle();
      act(() => {
        useRecordingStore.getState().changeActivityType('Run');
        result.current.startNow();
      });
      expect(started()).toHaveBeenCalledWith('Run', 'gps', undefined);
    });

    it('starts the sport tapped when nothing was chosen', () => {
      jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
      const { result } = idle();
      act(() => result.current.startNow());
      expect(started()).toHaveBeenCalledWith('Ride', 'gps', undefined);
    });

    it('records the sport actually started as the recent one', () => {
      jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
      const {
        useRecordingPreferences,
      } = require('@/features/recording/stores/RecordingPreferencesStore');
      const addRecent = jest
        .spyOn(useRecordingPreferences.getState(), 'addRecentType')
        .mockImplementation(jest.fn());
      const { result } = idle();
      act(() => {
        useRecordingStore.getState().changeActivityType('Run');
        result.current.startNow();
      });
      expect(addRecent).toHaveBeenCalledWith('Run');
    });
  });

  describe('the recording mode', () => {
    beforeEach(() => useRecordingStore.setState({ startRecording: realStartRecording }));

    const idleAs = (tapped: ActivityType) =>
      renderHook(() => useInitRecordingEffect('idle', tapped, undefined, true, 'quickstart'));

    it.each([
      ['Ride', 'VirtualRide', 'indoor'],
      ['VirtualRide', 'Ride', 'gps'],
      ['Run', 'Treadmill', 'indoor'],
      ['Ride', 'Yoga', 'manual'],
      ['Ride', null, 'gps'],
    ] as const)('idle as %s and changed to %s starts in %s', (tapped, chosen, mode) => {
      const { result } = idleAs(tapped);
      act(() => {
        if (chosen) useRecordingStore.getState().changeActivityType(chosen);
        result.current.startNow();
      });
      expect(useRecordingStore.getState().mode).toBe(mode);
      expect(useRecordingStore.getState().activityType).toBe(chosen ?? tapped);
    });
  });
});

describe('a sport chosen and then abandoned', () => {
  beforeEach(() => useRecordingStore.setState({ startRecording: realStartRecording }));

  it('does not carry into the next entry', () => {
    const first = renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart')
    );
    act(() => {
      useRecordingStore.getState().changeActivityType('VirtualRide');
    });
    first.unmount();

    expect(useRecordingStore.getState().activityType).toBeNull();

    const second = renderHook(() =>
      useInitRecordingEffect('idle', 'Run', undefined, true, 'quickstart')
    );
    act(() => second.result.current.startNow());
    expect(useRecordingStore.getState().activityType).toBe('Run');
    expect(useRecordingStore.getState().mode).toBe('gps');
  });

  it('does not carry into a second screen opened over the first', () => {
    const first = renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart')
    );
    act(() => {
      useRecordingStore.getState().changeActivityType('VirtualRide');
    });

    const second = renderHook(() =>
      useInitRecordingEffect('idle', 'Run', undefined, true, 'quickstart')
    );
    act(() => useRecordingStore.getState().changeActivityType('Treadmill'));
    // The first screen going must not undo the choice made on the second.
    first.unmount();
    act(() => second.result.current.startNow());

    expect(useRecordingStore.getState().activityType).toBe('Treadmill');
    expect(useRecordingStore.getState().mode).toBe('indoor');
  });

  it('starts the sport tapped on a second screen when nothing was chosen there', () => {
    const first = renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart')
    );
    act(() => {
      useRecordingStore.getState().changeActivityType('VirtualRide');
    });

    const second = renderHook(() =>
      useInitRecordingEffect('idle', 'Run', undefined, true, 'quickstart')
    );
    act(() => second.result.current.startNow());

    expect(useRecordingStore.getState().activityType).toBe('Run');
    first.unmount();
  });

  it('hands the choice back to the screen underneath when the one over it goes', () => {
    const first = renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart')
    );
    const second = renderHook(() =>
      useInitRecordingEffect('idle', 'Run', undefined, true, 'quickstart')
    );
    second.unmount();

    act(() => useRecordingStore.getState().changeActivityType('VirtualRide'));
    first.unmount();

    expect(useRecordingStore.getState().activityType).toBeNull();
  });

  it('starts the sport tapped in the picker over a sport left held', () => {
    useRecordingStore.getState().changeActivityType('VirtualRide');
    renderHook(() => useInitRecordingEffect('idle', 'Run', undefined, true, undefined));

    expect(useRecordingStore.getState().activityType).toBe('Run');
    expect(useRecordingStore.getState().mode).toBe('gps');
  });

  it.each(['recording', 'paused', 'stopped'] as const)(
    'keeps the sport of a %s ride the screen opens onto',
    (status) => {
      useRecordingStore.getState().startRecording('VirtualRide', 'indoor');
      useRecordingStore.setState({ status });
      const view = renderHook(() =>
        useInitRecordingEffect(status, 'Ride', undefined, true, 'quickstart')
      );
      view.unmount();

      expect(useRecordingStore.getState().activityType).toBe('VirtualRide');
    }
  );

  it('clears a sport picked after the ride this screen started was saved', () => {
    const view = renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart')
    );
    act(() => view.result.current.startNow());
    act(() => {
      useRecordingStore.getState().reset();
      useRecordingStore.getState().changeActivityType('VirtualRide');
    });
    view.unmount();

    expect(useRecordingStore.getState().activityType).toBeNull();
  });

  it('leaves a ride that started alone when the screen goes', () => {
    const view = renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart')
    );
    act(() => view.result.current.startNow());
    view.unmount();

    expect(useRecordingStore.getState().activityType).toBe('Ride');
    expect(useRecordingStore.getState().status).toBe('recording');
  });
});

describe('the layout the recording screen draws', () => {
  it('follows the sport chosen before the start, not the route param', () => {
    expect(
      screenRecordingMode({ status: 'idle', mode: null, activityType: 'VirtualRide' }, 'Ride')
    ).toBe('indoor');
    expect(screenRecordingMode({ status: 'idle', mode: null, activityType: 'Yoga' }, 'Ride')).toBe(
      'manual'
    );
  });

  it('uses the route param before anything is in the store', () => {
    expect(
      screenRecordingMode({ status: 'idle', mode: null, activityType: null }, 'Treadmill')
    ).toBe('indoor');
  });

  it('keeps the mode the ride started in once it is under way', () => {
    for (const status of ['recording', 'paused', 'stopped'] as const) {
      expect(
        screenRecordingMode({ status, mode: 'gps', activityType: 'VirtualRide' }, 'Ride')
      ).toBe('gps');
    }
  });
});
