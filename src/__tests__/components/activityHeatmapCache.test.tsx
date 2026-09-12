/**
 * Scenario: the year heatmap read the engine's own intensity cache and then
 * looped a parsed array of activity bodies over the top of it, to fill dates it
 * believed the cache did not cover.
 *
 * Expected behaviour: the cache is the whole answer. It is derived from
 * `activity_metrics` on every metrics write (`persistence/fitness/mod.rs:241`)
 * and rebuilt from that table by migration, and `activity_metrics` covers
 * exactly what `activity_bodies` covers, so there is nothing left to supplement.
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/native/useEngineSubscription', () => ({
  useEngineSubscription: () => 0,
}));

const today = new Date().toISOString().slice(0, 10);

const engine = {
  getActivityHeatmap: jest.fn(() => [
    { date: today, intensity: 3, maxDuration: 6000, activityCount: 1 },
  ]),
  getActivityBodies: jest.fn(() => []),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('ActivityHeatmap', () => {
  it('reads the engine cache and no activity bodies', async () => {
    render(<ActivityHeatmap />);

    await waitFor(() => expect(engine.getActivityHeatmap).toHaveBeenCalled());
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });

  it('draws the grid from the cache alone', async () => {
    const view = render(<ActivityHeatmap />);

    await waitFor(() => expect(engine.getActivityHeatmap).toHaveBeenCalled());
    expect(view.getByTestId('activity-heatmap-count')).toBeTruthy();
  });

  it('shows the empty state when the cache holds no day, rather than waiting for an array', async () => {
    engine.getActivityHeatmap.mockReturnValueOnce([]);

    const view = render(<ActivityHeatmap />);

    await waitFor(() => expect(engine.getActivityHeatmap).toHaveBeenCalled());
    expect(view.queryByTestId('activity-heatmap-count')).toBeNull();
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });
});
