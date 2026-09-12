/**
 * Which source the activity detail map draws its line from.
 *
 * Two sources carry the same ride and arrive at different times. The stream is
 * what the chart scrubber reads and is only present once the on-demand body
 * has landed. The stored track is written by the bulk ingest for every
 * activity the library has taken, survives offline and is full fidelity.
 *
 * There was a third, a lossy encoded summary off the activity record. It never
 * existed: intervals.icu serves no `polyline` field, measured over 851
 * activities on 2026-09-12, so the tier could not fire and the skip it drove
 * kept the stored-track read from running for no reason.
 */
import { convertLatLngTuples, type LatLng } from '@/shared/geo/polyline';

export interface DetailCoordinateSources {
  /** `latlng` as the stream body carries it, when that body has landed. */
  streamLatLng?: [number, number][] | undefined;
  /** The stored track, as `getGpsTrack` returns it. */
  gpsTrack?: { latitude: number; longitude: number }[] | undefined;
}

export function resolveDetailCoordinates(sources: DetailCoordinateSources): LatLng[] {
  const { streamLatLng, gpsTrack } = sources;

  if (streamLatLng && streamLatLng.length > 0) {
    return convertLatLngTuples(streamLatLng);
  }
  if (gpsTrack && gpsTrack.length > 0) {
    return gpsTrack.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  }
  return [];
}
