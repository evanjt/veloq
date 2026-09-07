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
import { render } from '@testing-library/react-native';
import { I18nManager } from 'react-native';

import { isolateNumeric, formatTimeDelta } from '@/shared/format/format';
import { ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { TodayBanner } from '@/features/routes/components/TodayBanner';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({ todayWorkout: null, tomorrowWorkout: null, isLoading: false }),
}));

jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));

jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [{ id: '2026-09-01', ctl: 40, atl: 52 }] }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
}));

const FSI = '⁨';
const PDI = '⁩';

/** The sign is adjacent to the digits it belongs to, in reading order. */
function signTouchesDigits(text: string): boolean {
  return /[+-]\d/.test(text) && !/\d\s*[+-](?!\d)/.test(text.replace(/\d[+-]\d/g, ''));
}

function withRtl(run: () => void) {
  const wasRtl = I18nManager.isRTL;
  I18nManager.isRTL = true;
  try {
    run();
  } finally {
    I18nManager.isRTL = wasRtl;
  }
}

describe('isolateNumeric', () => {
  it('leaves a left-to-right layout untouched', () => {
    expect(isolateNumeric('-0.2')).toBe('-0.2');
    expect(isolateNumeric('')).toBe('');
  });

  it('isolates the run under a right-to-left layout', () => {
    withRtl(() => {
      expect(isolateNumeric('-0.2')).toBe(`${FSI}-0.2${PDI}`);
      expect(isolateNumeric('+16')).toBe(`${FSI}+16${PDI}`);
    });
  });

  it('does not wrap an empty string, which has no run to isolate', () => {
    withRtl(() => {
      expect(isolateNumeric('')).toBe('');
    });
  });
});

describe('a delta chip under a right-to-left layout', () => {
  it('keeps the minus with the digits', () => {
    withRtl(() => {
      expect(formatTimeDelta(-90)).toBe(`${FSI}-1:30${PDI}`);
      expect(formatTimeDelta(90)).toBe(`${FSI}+1:30${PDI}`);
      expect(signTouchesDigits(formatTimeDelta(-5) as string)).toBe(true);
    });
  });

  it('still returns null below a second, so the isolate never stands alone', () => {
    withRtl(() => {
      expect(formatTimeDelta(0.5)).toBeNull();
    });
  });

  it('is unchanged left to right', () => {
    expect(formatTimeDelta(-90)).toBe('-1:30');
  });
});

describe('the grade chip under a right-to-left layout', () => {
  const grade = CHART_CONFIGS.grade;

  it('keeps the minus with the digits and the unit outside the run', () => {
    withRtl(() => {
      const tree = render(
        <ChartTypeSelector
          available={[grade]}
          selected={['grade']}
          onToggle={() => {}}
          metricValues={[{ id: 'grade', value: '-0.2', unit: '%', maxValueWidth: '-0.2' }]}
        />
      );
      const shown = tree
        .UNSAFE_getAllByType(require('react-native').Text)
        .flatMap((n) => n.props.children)
        .filter((c: unknown) => typeof c === 'string')
        .join('');
      expect(shown).toContain(`${FSI}-0.2${PDI}`);
      expect(signTouchesDigits(shown)).toBe(true);
    });
  });

  it('renders the plain value left to right', () => {
    const tree = render(
      <ChartTypeSelector
        available={[grade]}
        selected={['grade']}
        onToggle={() => {}}
        metricValues={[{ id: 'grade', value: '-0.2', unit: '%' }]}
      />
    );
    expect(tree.getAllByText('-0.2 %').length).toBeGreaterThan(0);
  });
});

describe('the TSB figure under a right-to-left layout', () => {
  it('keeps a negative balance signed', () => {
    withRtl(() => {
      const tree = render(<TodayBanner todayPattern={null} />);
      expect(tree.getByText(new RegExp(`${FSI}-12${PDI}`))).toBeTruthy();
    });
  });
});
