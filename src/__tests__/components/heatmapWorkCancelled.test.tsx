import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { HeatmapRow } from '@/features/settings/components/HeatmapRow';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: turning the heatmap off clears the tiles from disk. A pass drawing
 * them keeps running, so it writes tiles back over the ground that was just
 * cleared, and it holds a core doing it for work nobody wants any more.
 * Expected behaviour: the work is cancelled before the tiles are cleared.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : 'Heatmap'),
  }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/features/maps/hooks/useHeatmapTiles', () => ({
  HEATMAP_TILES_DIR: '/cache/heatmap-tiles/',
  getHeatmapTilesCacheSize: () => 0,
}));

const mockPreference = { enabled: true, setEnabled: jest.fn() };
jest.mock('@/features/maps/stores/HeatmapPreferenceStore', () => ({
  useHeatmapPreference: (select: (s: unknown) => unknown) => select(mockPreference),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function engine() {
  return {
    enableHeatmapTiles: jest.fn(),
    disableHeatmapTiles: jest.fn(),
    clearHeatmapTiles: jest.fn(() => 0),
    cancelHeatmapWork: jest.fn(() => true),
  };
}

describe('turning the heatmap off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreference.enabled = true;
  });

  it('stops the pass before it clears the tiles it is writing', () => {
    const mock = engine();
    mockedGetEngine.mockReturnValue(mock as never);

    const { getByTestId } = render(<HeatmapRow />);
    fireEvent(getByTestId('heatmap-switch'), 'valueChange', false);

    expect(mock.cancelHeatmapWork).toHaveBeenCalledTimes(1);
    expect(mock.cancelHeatmapWork.mock.invocationCallOrder[0]).toBeLessThan(
      mock.clearHeatmapTiles.mock.invocationCallOrder[0]
    );
  });

  /** Turning it on must not cancel: the pass it starts is the point. */
  it('cancels nothing when the heatmap is turned on', () => {
    const mock = engine();
    mockedGetEngine.mockReturnValue(mock as never);
    mockPreference.enabled = false;

    const { getByTestId } = render(<HeatmapRow />);
    fireEvent(getByTestId('heatmap-switch'), 'valueChange', true);

    expect(mock.cancelHeatmapWork).not.toHaveBeenCalled();
    expect(mock.enableHeatmapTiles).toHaveBeenCalledTimes(1);
  });
});
