/**
 * Scenario: an activity detail screen opened offline, for a ride whose stream
 * body was never fetched but whose track the bulk ingest stored.
 *
 * Expected behaviour: the map draws from the stored track. Before this, the
 * memo read the stream then an encoded summary and asked the engine for
 * neither, so the screen rendered the indoor no-map header over a complete
 * track. That summary tier is gone: intervals.icu serves no such field.
 */
import { resolveDetailCoordinates } from '@/features/activity/lib/detailCoordinates';

const TRACK = [
  { latitude: -37.81, longitude: 144.96 },
  { latitude: -37.82, longitude: 144.97 },
];

describe('resolveDetailCoordinates', () => {
  it('draws the stored track when no stream body has landed', () => {
    expect(resolveDetailCoordinates({ gpsTrack: TRACK })).toEqual(TRACK);
  });

  it('prefers the stream over the stored track', () => {
    const coords = resolveDetailCoordinates({
      streamLatLng: [
        [-37.0, 144.0],
        [-37.1, 144.1],
      ],
      gpsTrack: TRACK,
    });
    expect(coords[0]).toEqual({ latitude: -37.0, longitude: 144.0 });
  });

  it('treats an empty track as absent rather than as an answer', () => {
    expect(resolveDetailCoordinates({ gpsTrack: [] })).toEqual([]);
  });

  it('treats an empty stream as absent rather than as an answer', () => {
    const coords = resolveDetailCoordinates({ streamLatLng: [], gpsTrack: TRACK });
    expect(coords).toEqual(TRACK);
  });

  it('returns nothing when every source is missing', () => {
    expect(resolveDetailCoordinates({})).toEqual([]);
  });
});
