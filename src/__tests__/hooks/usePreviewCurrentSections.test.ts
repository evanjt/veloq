/**
 * Scenario: the preview screen opens on a riding area and must show what the
 * detector holds for that area today, before anything is previewed.
 * Expected behaviour: the live catalogue is read once per area, re-read when
 * the area changes, and an engine that has nothing or throws leaves the screen
 * with an empty catalogue rather than a crash.
 */

import { renderHook } from '@testing-library/react-native';
import { usePreviewCurrentSections } from '@/features/routes/hooks/usePreviewCurrentSections';
import type { PreviewCentre, PreviewSection } from '../../../modules/veloqrs/src/delegates/preview';

const CENTRE: PreviewCentre = {
  binKey: '9:27',
  lat: 47.5,
  lng: 8.7,
  visitTotal: 40,
  sectionCount: 3,
  source: 'sections',
};

const OTHER_CENTRE: PreviewCentre = {
  binKey: '10:28',
  lat: 46.2,
  lng: 6.1,
  visitTotal: 12,
  sectionCount: 1,
  source: 'sections',
};

function section(id: string): PreviewSection {
  return {
    id,
    liveId: id,
    status: 'unchanged',
    name: `Section ${id}`,
    sport: 'Ride',
    polylineBase64: 'AAAA',
    visits: 7,
    distanceM: 4200,
    elevationGainM: 88,
    avgGradePercent: 2.1,
    pinned: false,
  };
}

describe('usePreviewCurrentSections', () => {
  it('reads the live catalogue for the area on mount', () => {
    const getPreviewCurrentSections = jest.fn(() => [section('a'), section('b')]);
    const client = { getPreviewCurrentSections } as never;

    const { result } = renderHook(() => usePreviewCurrentSections(client, CENTRE));

    expect(getPreviewCurrentSections).toHaveBeenCalledWith(CENTRE.lat, CENTRE.lng);
    expect(result.current.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('re-reads when the chosen area changes and not otherwise', () => {
    const getPreviewCurrentSections = jest.fn(() => [section('a')]);
    const client = { getPreviewCurrentSections } as never;

    const { rerender } = renderHook(
      ({ centre }: { centre: PreviewCentre }) => usePreviewCurrentSections(client, centre),
      { initialProps: { centre: CENTRE } }
    );

    rerender({ centre: { ...CENTRE } });
    expect(getPreviewCurrentSections).toHaveBeenCalledTimes(1);

    rerender({ centre: OTHER_CENTRE });
    expect(getPreviewCurrentSections).toHaveBeenCalledTimes(2);
    expect(getPreviewCurrentSections).toHaveBeenLastCalledWith(OTHER_CENTRE.lat, OTHER_CENTRE.lng);
  });

  it('holds an empty catalogue when the area has no sections yet', () => {
    const client = { getPreviewCurrentSections: jest.fn(() => []) } as never;

    const { result } = renderHook(() => usePreviewCurrentSections(client, CENTRE));

    expect(result.current).toEqual([]);
  });

  it('holds an empty catalogue when there is no client or no area', () => {
    const getPreviewCurrentSections = jest.fn(() => [section('a')]);
    const client = { getPreviewCurrentSections } as never;

    const withoutClient = renderHook(() => usePreviewCurrentSections(null, CENTRE));
    expect(withoutClient.result.current).toEqual([]);

    const withoutCentre = renderHook(() => usePreviewCurrentSections(client, null));
    expect(withoutCentre.result.current).toEqual([]);
    expect(getPreviewCurrentSections).not.toHaveBeenCalled();
  });

  it('survives an engine that throws', () => {
    const client = {
      getPreviewCurrentSections: jest.fn(() => {
        throw new Error('engine gone');
      }),
    } as never;

    const { result } = renderHook(() => usePreviewCurrentSections(client, CENTRE));

    expect(result.current).toEqual([]);
  });

  it('reads again when the screen is opened a second time', () => {
    const getPreviewCurrentSections = jest.fn(() => [section('a')]);
    const client = { getPreviewCurrentSections } as never;

    const first = renderHook(() => usePreviewCurrentSections(client, CENTRE));
    first.unmount();
    const second = renderHook(() => usePreviewCurrentSections(client, CENTRE));

    expect(getPreviewCurrentSections).toHaveBeenCalledTimes(2);
    expect(second.result.current.map((s) => s.id)).toEqual(['a']);
  });
});
