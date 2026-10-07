import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { getEngine } from '@/shared/native/engine';
import { trainingScreenRead } from '../__shared__/trainingScreenRead';

/**
 * Scenario: the heatmap read the engine's day cache inside a memo keyed on
 * the `activities` prop, a proxy that usually moves with a sync and is not the
 * event. A sync that fills the cache without changing the prop never reached
 * the grid.
 *
 * Expected behaviour: the training screen read the grid paints from follows
 * the `activities` channel.
 */

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

// The shared Skia mock has the components but not the imperative recorder the
// grid is drawn with, so this file stands one up.
jest.mock('@shopify/react-native-skia', () => {
  const canvas = {
    drawRRect: jest.fn(),
    drawCircle: jest.fn(),
    drawRect: jest.fn(),
    drawLine: jest.fn(),
  };
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
      Paint: () => ({ setColor: jest.fn(), setStrokeWidth: jest.fn() }),
      Color: jest.fn(),
    },
  };
});

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const listeners = new Map<string, Set<() => void>>();
const heatmapDays = jest.fn(() => [
  { date: '2026-01-01', intensity: 3, maxDuration: 3600, activityCount: 1 },
]);

const engine = {
  subscribe: (event: string, cb: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    set.add(cb);
    listeners.set(event, set);
    return () => set.delete(cb);
  },
  getTrainingScreenData: trainingScreenRead({ heatmap: heatmapDays }),
};

function renderHeatmap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivityHeatmap />
    </QueryClientProvider>
  );
}

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
  it('re-reads the day cache when activities change', async () => {
    renderHeatmap();
    await waitFor(() => expect(heatmapDays).toHaveBeenCalledTimes(1));

    emit('activities');
    await waitFor(() => expect(heatmapDays).toHaveBeenCalledTimes(2));
  });

  it('ignores an event it does not depend on', async () => {
    renderHeatmap();
    await waitFor(() => expect(heatmapDays).toHaveBeenCalledTimes(1));

    emit('sections');
    expect(heatmapDays).toHaveBeenCalledTimes(1);
  });

  it('renders on an engine that throws and still re-reads on the next event', async () => {
    heatmapDays.mockImplementation(() => {
      throw new Error('engine down');
    });
    const view = renderHeatmap();
    await waitFor(() => expect(heatmapDays).toHaveBeenCalledTimes(1));
    expect(view.getByText('stats.activityCalendar')).toBeTruthy();

    emit('activities');
    await waitFor(() => expect(heatmapDays).toHaveBeenCalledTimes(2));
  });
});
