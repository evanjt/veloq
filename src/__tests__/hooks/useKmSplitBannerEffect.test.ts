/**
 * Scenario: a GPS run passes whole kilometres, and the status slot should say
 * so with the split's pace.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useKmSplitBannerEffect } from '@/features/recording/hooks/useKmSplitBannerEffect';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

type Props = { distanceLength: number; startTime: number | null };

function runTo(metres: number[], seconds: number[]): void {
  const { streams } = useRecordingStore.getState();
  useRecordingStore.setState({
    streams: { ...streams, distance: metres, time: seconds },
  });
}

function mount(setSplitBanner: jest.Mock) {
  return renderHook(
    ({ distanceLength, startTime }: Props) =>
      useKmSplitBannerEffect({
        mode: 'gps',
        status: 'recording',
        distanceLength,
        startTime,
        isMetric: true,
        setSplitBanner,
      }),
    { initialProps: { distanceLength: 0, startTime: 1 } }
  );
}

describe('useKmSplitBannerEffect', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useRecordingStore.getState().reset();
  });

  afterEach(() => {
    jest.useRealTimers();
    useRecordingStore.getState().reset();
  });

  it('shows nothing below the first kilometre', () => {
    const setSplitBanner = jest.fn();
    const { rerender } = mount(setSplitBanner);
    runTo([0, 500, 999], [0, 150, 300]);
    rerender({ distanceLength: 3, startTime: 1 });
    expect(setSplitBanner).not.toHaveBeenCalled();
  });

  it('shows one banner at each whole kilometre, the first included', () => {
    const setSplitBanner = jest.fn();
    const { rerender } = mount(setSplitBanner);

    runTo([0, 500, 1000], [0, 150, 300]);
    rerender({ distanceLength: 3, startTime: 1 });
    runTo([0, 500, 1000, 1500], [0, 150, 300, 450]);
    rerender({ distanceLength: 4, startTime: 1 });
    runTo([0, 500, 1000, 1500, 2010], [0, 150, 300, 450, 600]);
    rerender({ distanceLength: 5, startTime: 1 });

    const banners = setSplitBanner.mock.calls.map(([b]) => b).filter((b) => b !== null);
    expect(banners).toHaveLength(2);
  });

  it('starts from zero again for a second ride on a mounted screen', () => {
    const setSplitBanner = jest.fn();
    const { rerender } = mount(setSplitBanner);
    runTo([0, 1000, 2000], [0, 300, 600]);
    rerender({ distanceLength: 3, startTime: 1 });
    setSplitBanner.mockClear();

    // A new ride starts on empty streams.
    runTo([], []);
    act(() => rerender({ distanceLength: 0, startTime: 2 }));
    runTo([0, 1000], [0, 300]);
    act(() => rerender({ distanceLength: 2, startTime: 2 }));

    const banners = setSplitBanner.mock.calls.map(([b]) => b).filter((b) => b !== null);
    expect(banners).toHaveLength(1);
  });

  it('counts from the splits already passed when the screen mounts mid-ride', () => {
    const setSplitBanner = jest.fn();
    runTo([0, 6000, 12_300], [0, 1800, 3700]);
    const { rerender } = renderHook(
      ({ distanceLength }: { distanceLength: number }) =>
        useKmSplitBannerEffect({
          mode: 'gps',
          status: 'recording',
          distanceLength,
          startTime: 1,
          isMetric: true,
          setSplitBanner,
        }),
      { initialProps: { distanceLength: 3 } }
    );
    runTo([0, 6000, 12_300, 12_800], [0, 1800, 3700, 3850]);
    rerender({ distanceLength: 4 });
    expect(setSplitBanner).not.toHaveBeenCalled();

    runTo([0, 6000, 12_300, 12_800, 13_050], [0, 1800, 3700, 3850, 3925]);
    rerender({ distanceLength: 5 });
    const banners = setSplitBanner.mock.calls.map(([b]) => b).filter((b) => b !== null);
    expect(banners).toHaveLength(1);
  });

  it("gives the ride's pauses back from the split pace", () => {
    const setSplitBanner = jest.fn();
    const { rerender } = mount(setSplitBanner);
    useRecordingStore.setState({ pauseIntervals: [{ start: 150, end: 750 }] });
    runTo([0, 500, 500, 1000], [0, 150, 750, 900]);
    rerender({ distanceLength: 4, startTime: 1 });

    const banners = setSplitBanner.mock.calls.map(([b]) => b).filter((b) => b !== null);
    expect(banners).toHaveLength(1);
    expect(banners[0]).toContain('"pace":"5:00 /km"');
  });
});
