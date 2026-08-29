/**
 * Scenario: a GPS recording paused mid-ride is reviewed and saved.
 *
 * Expected behaviour: the summary duration is moving time, so it matches the
 * timer time the FIT writer records and the duration intervals.icu reports.
 */

import { renderHook } from "@testing-library/react-native";

import { useActivitySummary } from "@/features/recording/hooks/useActivitySummary";
import { pausedSecondsBetween } from "@/features/recording/lib/pausedTime";
import type { RecordingStreams } from "@/features/recording/types";

const START = 1_700_000_000_000;

/** Four points at 0, 10, 610 and 620 s, with a 600 s pause between 10 and 610. */
function streamsWithPause(): RecordingStreams {
  const time = [0, 10, 610, 620];
  return {
    time,
    latlng: time.map((_, i) => [1 + i * 0.001, 2] as [number, number]),
    altitude: time.map(() => 0),
    heartrate: time.map(() => 0),
    power: time.map(() => 0),
    cadence: time.map(() => 0),
    speed: time.map(() => 0),
    distance: [0, 100, 200, 300],
  };
}

const PAUSES = [{ start: 10, end: 610 }];

function summaryFor(
  overrides: Partial<Parameters<typeof useActivitySummary>[0]> = {},
) {
  const streams = streamsWithPause();
  const { result } = renderHook(() =>
    useActivitySummary({
      streams,
      startTime: START,
      stopTime: START + 620_000,
      pausedDuration: 600_000,
      pauseIntervals: PAUSES,
      trimStart: 0,
      trimEnd: streams.time.length - 1,
      canTrim: true,
      isManual: false,
      params: {},
      ...overrides,
    }),
  );
  return result.current;
}

describe("pausedSecondsBetween", () => {
  it("counts only the overlap with the window", () => {
    expect(pausedSecondsBetween(PAUSES, 0, 620)).toBe(600);
    expect(pausedSecondsBetween(PAUSES, 300, 620)).toBe(310);
    expect(pausedSecondsBetween(PAUSES, 610, 620)).toBe(0);
    expect(pausedSecondsBetween(PAUSES, 620, 620)).toBe(0);
  });
});

describe("useActivitySummary duration", () => {
  it("excludes paused time from the whole recording", () => {
    const { summary } = summaryFor();
    expect(summary.duration).toBe(20);
    expect(summary.avgSpeed).toBeCloseTo(300 / 20);
  });

  it("excludes only the pause inside a trimmed window", () => {
    const { summary, pausedSecondsInWindow } = summaryFor({
      trimStart: 1,
      trimEnd: 3,
    });
    expect(pausedSecondsInWindow).toBe(600);
    expect(summary.duration).toBe(10);
  });

  it("reports no paused time for a window after the pause", () => {
    const { summary, pausedSecondsInWindow } = summaryFor({
      trimStart: 2,
      trimEnd: 3,
    });
    expect(pausedSecondsInWindow).toBe(0);
    expect(summary.duration).toBe(10);
  });
});
