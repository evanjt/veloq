import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { HeatmapRow } from '@/features/settings/components/HeatmapRow';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: turning the heatmap off clears the tiles from disk. A pass drawing
 * them kept running and held a core for work nobody wants any more, and a tile
 * that could not be removed went unreported, so the row said nothing while the
 * heat stayed on disk.
 * Expected behaviour: the heatmap is off before the clear, so no pass starts
 * during it, the work is cancelled, every tile set is attempted, and a clear
 * that left tiles behind is reported.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : 'Heatmap'),
  }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/features/maps/lib/heatmapTiles', () => ({
  ...jest.requireActual('@/features/maps/lib/heatmapTiles'),
  HEATMAP_TILES_DIR: '/cache/heatmap-tiles/',
  readHeatmapTilesCacheSize: async () => 0,
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
    clearHeatmapTiles: jest.fn((_dir: string) => Promise.resolve()),
    cancelHeatmapWork: jest.fn(() => true),
  };
}

describe('turning the heatmap off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreference.enabled = true;
  });

  it('turns generation off and stops the work before it clears the tiles', async () => {
    const mock = engine();
    mockedGetEngine.mockReturnValue(mock as never);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByTestId } = render(<HeatmapRow />);
    fireEvent(getByTestId('heatmap-switch'), 'valueChange', false);

    await waitFor(() => expect(mock.clearHeatmapTiles).toHaveBeenCalledTimes(2));
    const firstClear = mock.clearHeatmapTiles.mock.invocationCallOrder[0];
    expect(mock.disableHeatmapTiles.mock.invocationCallOrder[0]).toBeLessThan(firstClear);
    expect(mock.cancelHeatmapWork.mock.invocationCallOrder[0]).toBeLessThan(firstClear);
    expect(alert).not.toHaveBeenCalled();
  });

  it('reports a clear that left tiles on disk, having tried every set', async () => {
    const mock = engine();
    mock.clearHeatmapTiles.mockImplementation((dir: string) =>
      dir === '/cache/heatmap-tiles/'
        ? Promise.reject(new Error('Could not remove heatmap tiles'))
        : Promise.resolve()
    );
    mockedGetEngine.mockReturnValue(mock as never);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByTestId } = render(<HeatmapRow />);
    fireEvent(getByTestId('heatmap-switch'), 'valueChange', false);

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(mock.clearHeatmapTiles).toHaveBeenCalledTimes(2);
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
