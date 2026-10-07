/**
 * Scenario: the GPX and GeoJSON pills sit side by side and drive the same
 * progress row and the same completion alert.
 *
 * Expected behaviour: both name the format actually being written. Telling an
 * athlete who tapped GeoJSON that the app is generating GPX is wrong about the
 * files they are about to be handed.
 */

import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { BulkExportProgress } from '@/features/settings/components/BulkExportProgress';
import { useBulkExport } from '@/features/settings/hooks/useBulkExport';

// The key alone cannot show whether the format reached the string, so the stub
// renders the interpolation beside it.
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

jest.mock('@/features/settings/lib/bulkExport', () => ({
  bulkExportActivities: jest.fn(),
  bulkExportActivitiesGeoJson: jest.fn(),
  resumePendingBulkExport: jest.fn(),
  hasPendingBulkExport: () => false,
  pendingBulkExportSettled: () => Promise.resolve(),
  pendingBulkExportKind: () => null,
  // A worker still writing, which is what a still-running outcome means.
  readBulkExportProgress: () => ({ current: 0, total: 0 }),
  PROGRESS_INTERVAL_MS: 250,
}));

const { bulkExportActivities, bulkExportActivitiesGeoJson, resumePendingBulkExport } =
  jest.requireMock('@/features/settings/lib/bulkExport') as {
    bulkExportActivities: jest.Mock;
    bulkExportActivitiesGeoJson: jest.Mock;
    resumePendingBulkExport: jest.Mock;
  };

const complete = (kind: 'gpx' | 'geojson', exported: number, noTrack: number) => ({
  state: 'complete',
  exported,
  noTrack,
  trimmed: 0,
  failed: 0,
  kind,
});

beforeEach(() => {
  bulkExportActivities.mockReset().mockResolvedValue(complete('gpx', 3, 0));
  bulkExportActivitiesGeoJson.mockReset().mockResolvedValue(complete('geojson', 3, 0));
  resumePendingBulkExport.mockReset().mockResolvedValue({ state: 'nothing-pending' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('the progress row names the format being written', () => {
  it('says GeoJSON for a GeoJSON export', () => {
    render(
      <BulkExportProgress
        phase="generating"
        format="geojson"
        current={0}
        total={0}
        sizeBytes={0}
        isDark={false}
      />
    );

    expect(screen.getByText(/export\.bulkExporting.*GeoJSON/)).toBeTruthy();
  });

  it('says GPX for a GPX export', () => {
    render(
      <BulkExportProgress
        phase="generating"
        format="gpx"
        current={0}
        total={0}
        sizeBytes={0}
        isDark={false}
      />
    );

    expect(screen.getByText(/export\.bulkExporting.*GPX/)).toBeTruthy();
    expect(screen.queryByText(/GeoJSON/)).toBeNull();
  });
});

describe('the hook reports which format is running', () => {
  it('reports geojson for the GeoJSON pill', async () => {
    const { result } = renderHook(() => useBulkExport());

    act(() => {
      result.current.exportAllGeoJson();
    });

    expect(result.current.format).toBe('geojson');
    await waitFor(() => expect(bulkExportActivitiesGeoJson).toHaveBeenCalled());
  });

  it('reports gpx for the GPX pill', async () => {
    const { result } = renderHook(() => useBulkExport());

    act(() => {
      result.current.exportAll();
    });

    expect(result.current.format).toBe('gpx');
    await waitFor(() => expect(bulkExportActivities).toHaveBeenCalled());
  });

  it('names the format in the alert that reports what was skipped', async () => {
    bulkExportActivitiesGeoJson.mockResolvedValue(complete('geojson', 2, 1));
    const { result } = renderHook(() => useBulkExport());

    await act(async () => {
      await result.current.exportAllGeoJson();
    });

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const body = (Alert.alert as jest.Mock).mock.calls[0][1] as string;
    expect(body).toContain('GeoJSON');
    expect(body).not.toContain('GPX');
  });
});

/**
 * Expected behaviour: an export still writing when the minute is up is said to
 * be still running, and the pills are not left claiming a failure.
 */
describe('an export that outlived the wait', () => {
  it('reports it as still running rather than as an error', async () => {
    bulkExportActivities.mockResolvedValue({ state: 'still-running' });
    // The spy carries its calls across tests in this file.
    (Alert.alert as jest.Mock).mockClear();
    const { result } = renderHook(() => useBulkExport());

    await act(async () => {
      await result.current.exportAll();
    });

    expect(result.current.stillRunning).toBe(true);
    expect(result.current.error).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('stops saying so once the file the next mount finds has been shared', async () => {
    resumePendingBulkExport.mockResolvedValue(complete('gpx', 3, 0));
    const { result } = renderHook(() => useBulkExport());

    await waitFor(() => expect(resumePendingBulkExport).toHaveBeenCalled());
    expect(result.current.stillRunning).toBe(false);
  });
});
