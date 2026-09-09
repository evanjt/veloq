/**
 * Scenario: `stream_bodies.types` is documented in `016_stream_bodies.sql` as
 * the requested series "comma-joined and sorted", and it is the primary key.
 * Expected behaviour: two call sites asking for the same series in different
 * orders address one cached row rather than two.
 */

import {
  streamTypesKey,
  readStreams,
  requestStreams,
  DETAIL_STREAM_TYPES,
  PREVIEW_STREAM_TYPES,
} from '@/features/activity/lib/engineStreams';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  getStreamBody: jest.fn(),
  syncActivityStreams: jest.fn(),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

describe('streamTypesKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ isDemoMode: false });
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  });

  it('is order independent', () => {
    expect(streamTypesKey(['watts', 'time', 'latlng'])).toBe(
      streamTypesKey(['latlng', 'time', 'watts'])
    );
  });

  it('joins on a comma in sorted order', () => {
    expect(streamTypesKey(['watts', 'time', 'latlng'])).toBe('latlng,time,watts');
  });

  it('leaves the empty selection empty', () => {
    expect(streamTypesKey([])).toBe('');
  });

  it('does not mutate the caller array', () => {
    const types = ['watts', 'time'];
    streamTypesKey(types);
    expect(types).toEqual(['watts', 'time']);
  });

  it('reads and requests the shipped selections under the same key', () => {
    engine.getStreamBody.mockReturnValue(null);

    readStreams('a1', DETAIL_STREAM_TYPES);
    requestStreams('a1', DETAIL_STREAM_TYPES);

    const readKey = engine.getStreamBody.mock.calls[0][1];
    const requestKey = engine.syncActivityStreams.mock.calls[0][1];
    expect(readKey).toBe(requestKey);
    expect(readKey).toBe(streamTypesKey(DETAIL_STREAM_TYPES));
    expect(readKey).toBe([...DETAIL_STREAM_TYPES].sort().join(','));
  });

  it('keeps the preview selection distinct from the detail selection', () => {
    expect(streamTypesKey(PREVIEW_STREAM_TYPES)).not.toBe(streamTypesKey(DETAIL_STREAM_TYPES));
  });
});
