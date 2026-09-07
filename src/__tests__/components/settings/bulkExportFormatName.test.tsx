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
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

jest.mock('@/features/settings/lib/bulkExport', () => ({
  bulkExportActivities: jest.fn(),
  bulkExportActivitiesGeoJson: jest.fn(),
}));

const { bulkExportActivities, bulkExportActivitiesGeoJson } = jest.requireMock(
  '@/features/settings/lib/bulkExport'
) as {
  bulkExportActivities: jest.Mock;
  bulkExportActivitiesGeoJson: jest.Mock;
};

beforeEach(() => {
  bulkExportActivities.mockReset().mockResolvedValue({ exported: 3, skipped: 0 });
  bulkExportActivitiesGeoJson.mockReset().mockResolvedValue({ exported: 3, skipped: 0 });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('the progress row names the format being written', () => {
  it('says GeoJSON for a GeoJSON export', () => {
    render(<BulkExportProgress phase="generating" format="geojson" sizeBytes={0} isDark={false} />);

    expect(screen.getByText(/export\.bulkExporting.*GeoJSON/)).toBeTruthy();
  });

  it('says GPX for a GPX export', () => {
    render(<BulkExportProgress phase="generating" format="gpx" sizeBytes={0} isDark={false} />);

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
    bulkExportActivitiesGeoJson.mockResolvedValue({ exported: 2, skipped: 1 });
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
