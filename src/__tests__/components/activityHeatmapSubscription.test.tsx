import React from 'react';
import { render, act } from '@testing-library/react-native';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: the heatmap reads the engine's day cache inside a memo keyed on
 * the `activities` prop, a proxy that usually moves with a sync and is not the
 * event. A sync that fills the cache without changing the prop never reaches
 * the grid.
 *
 * Expected behaviour: the read follows the `activities` channel.
 */

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

// The shared Skia mock has the components but not the imperative recorder the
// grid is drawn with, so this file stands one up.
jest.mock('@shopify/react-native-skia', () => {
  const canvas = { drawRRect: jest.fn(), drawCircle: jest.fn(), drawRect: jest.fn() };
  const recorder = {
    beginRecording: () => canvas,
    finishRecordingAsPicture: () => ({}),
  };
  return {
    Canvas: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Picture: () => null,
    Skia: {
      PictureRecorder: () => recorder,
      XYWHRect: jest.fn(),
      RRectXY: jest.fn(),
      Paint: () => ({ setColor: jest.fn() }),
      Color: jest.fn(),
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const listeners = new Map<string, Set<() => void>>();
const getActivityHeatmap = jest.fn(() => [{ date: '2026-01-01', intensity: 3 }]);

const engine = {
  subscribe: (event: string, cb: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    set.add(cb);
    listeners.set(event, set);
    return () => set.delete(cb);
  },
  getActivityHeatmap,
};

function emit(event: string) {
  act(() => {
    listeners.get(event)?.forEach((cb) => cb());
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

describe('ActivityHeatmap', () => {
  it('re-reads the day cache when activities change', () => {
    render(<ActivityHeatmap />);
    const afterMount = getActivityHeatmap.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    emit('activities');
    expect(getActivityHeatmap.mock.calls.length).toBe(afterMount + 1);
  });

  it('ignores an event it does not depend on', () => {
    render(<ActivityHeatmap />);
    const afterMount = getActivityHeatmap.mock.calls.length;

    emit('sections');
    expect(getActivityHeatmap.mock.calls.length).toBe(afterMount);
  });

  it('renders on an engine that throws and still re-reads on the next event', () => {
    getActivityHeatmap.mockImplementation(() => {
      throw new Error('engine down');
    });
    render(<ActivityHeatmap />);
    const afterMount = getActivityHeatmap.mock.calls.length;

    emit('activities');
    expect(getActivityHeatmap.mock.calls.length).toBe(afterMount + 1);
  });
});
