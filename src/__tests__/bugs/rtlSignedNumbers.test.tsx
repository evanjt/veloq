/**
 * Scenario: under a right-to-left layout a grade of -0.2% renders as `% 0.2-`.
 * A signed number is all weak and neutral characters, so the bidirectional
 * algorithm resolves the sign from the surrounding paragraph and leaves it
 * trailing the digits it belongs to.
 *
 * Expected behaviour: every signed value the app shows keeps its sign next to
 * its digits in any layout direction, and left-to-right output is byte for
 * byte what it was.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { I18nManager, View } from 'react-native';

import { isolateNumeric, formatTimeDelta } from '@/shared/format/format';
import { ActivityStreams } from '@/features/activity/components/ActivityStreams';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { TodayBanner } from '@/features/routes/components/TodayBanner';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({ todayWorkout: null, tomorrowWorkout: null, isLoading: false }),
}));

jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));

jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [{ id: '2026-09-01', ctl: 40, atl: 52 }] }),
}));

const FSI = '⁨';
const PDI = '⁩';

/** The sign is adjacent to the digits it belongs to, in reading order. */
function signTouchesDigits(text: string): boolean {
  return /[+-]\d/.test(text) && !/\d\s*[+-](?!\d)/.test(text.replace(/\d[+-]\d/g, ''));
}

async function withRtl(run: () => Promise<void>) {
  const wasRtl = I18nManager.isRTL;
  I18nManager.isRTL = true;
  try {
    await run();
  } finally {
    I18nManager.isRTL = wasRtl;
  }
}

describe('isolateNumeric', () => {
  it('leaves a left-to-right layout untouched', () => {
    expect(isolateNumeric('-0.2')).toBe('-0.2');
    expect(isolateNumeric('')).toBe('');
  });

  it('isolates the run under a right-to-left layout', async () => {
    await withRtl(async () => {
      expect(isolateNumeric('-0.2')).toBe(`${FSI}-0.2${PDI}`);
      expect(isolateNumeric('+16')).toBe(`${FSI}+16${PDI}`);
    });
  });

  it('does not wrap an empty string, which has no run to isolate', async () => {
    await withRtl(async () => {
      expect(isolateNumeric('')).toBe('');
    });
  });
});

describe('a delta chip under a right-to-left layout', () => {
  it('keeps the minus with the digits', async () => {
    await withRtl(async () => {
      expect(formatTimeDelta(-90)).toBe(`${FSI}-1:30${PDI}`);
      expect(formatTimeDelta(90)).toBe(`${FSI}+1:30${PDI}`);
      expect(signTouchesDigits(formatTimeDelta(-5) as string)).toBe(true);
    });
  });

  it('still returns null below a second, so the isolate never stands alone', async () => {
    await withRtl(async () => {
      expect(formatTimeDelta(0.5)).toBeNull();
    });
  });

  it('is unchanged left to right', () => {
    expect(formatTimeDelta(-90)).toBe('-1:30');
  });
});

describe('the grade lane title under a right-to-left layout', () => {
  const streams = {
    time: Float64Array.from([0, 60, 120]),
    distance: Float64Array.from([0, 400, 800]),
    grade_smooth: Float64Array.from([-0.2, -0.2, -0.2]),
  };

  async function drawGradeLane() {
    const tree = await render(
      <ActivityStreams
        streams={streams}
        elevationGain={0}
        selectedCharts={['grade']}
        chartConfigs={CHART_CONFIGS}
      />
    );
    for (const box of tree.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout)) {
      await act(async () => {
        await fireEvent(box, 'layout', { nativeEvent: { layout: { width: 320, height: 56 } } });
      });
    }
    return tree;
  }

  function drawnValue(tree: Awaited<ReturnType<typeof render>>): string {
    const flatten = (node: ReactTestInstance): string =>
      node.children
        .map((c: ReactTestInstance | string) => (typeof c === 'string' ? c : flatten(c)))
        .join('');
    return flatten(tree.getByTestId('activity-lane-grade-value'));
  }

  it('keeps the minus with the digits', async () => {
    await withRtl(async () => {
      const shown = drawnValue(await drawGradeLane());
      expect(shown).toContain(`${FSI}-0.2${PDI}`);
      expect(signTouchesDigits(shown)).toBe(true);
    });
  });

  it('renders the plain value left to right', async () => {
    expect(drawnValue(await drawGradeLane())).toMatch(/-0\.2$/);
  });
});

describe('the TSB figure under a right-to-left layout', () => {
  it('keeps a negative balance signed', async () => {
    await withRtl(async () => {
      const tree = await render(<TodayBanner form={{ ctl: 40, atl: 52 }} />);
      expect(tree.getByText(new RegExp(`${FSI}-12${PDI}`))).toBeTruthy();
    });
  });
});
