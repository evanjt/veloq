/**
 * Scenario: the engine's stream store is a bounded LRU, far smaller than the
 * demo fixture set, so demo activities are usually absent from it.
 * Expected behaviour: a demo-mode miss is answered by the fixture generator
 * and never turned into a network request, while live-mode behaviour is
 * unchanged.
 */

import {
  readStreams,
  requestStreams,
  DETAIL_STREAM_TYPES,
} from '@/features/activity/lib/engineStreams';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

const engine = {
  getStreamBody: jest.fn(),
  syncActivityStreams: jest.fn(),
};

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

function setDemoMode(on: boolean) {
  useAuthStore.setState({ isDemoMode: on });
}

describe('readStreams in demo mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRouteEngine.mockReturnValue(engine as unknown as ReturnType<typeof getRouteEngine>);
  });

  afterEach(() => {
    setDemoMode(false);
  });

  it('answers a store miss from the demo generator', () => {
    engine.getStreamBody.mockReturnValue(null);
    setDemoMode(true);

    const streams = readStreams('demo-test-0', DETAIL_STREAM_TYPES);

    expect(streams).not.toBeNull();
    expect(streams?.time?.length).toBeGreaterThan(0);
    expect(streams?.latlng?.length).toBeGreaterThan(0);
  });

  it('still reads a stored body before falling back', () => {
    engine.getStreamBody.mockReturnValue(JSON.stringify({ time: [0, 5, 10] }));
    setDemoMode(true);

    const streams = readStreams('demo-test-0', DETAIL_STREAM_TYPES);

    expect(streams?.time).toEqual([0, 5, 10]);
  });

  it('returns null on a miss outside demo mode', () => {
    engine.getStreamBody.mockReturnValue(null);
    setDemoMode(false);

    expect(readStreams('some-live-id', DETAIL_STREAM_TYPES)).toBeNull();
  });

  it('never asks Rust to fetch streams while in demo mode', () => {
    setDemoMode(true);
    requestStreams('demo-test-0', DETAIL_STREAM_TYPES);
    expect(engine.syncActivityStreams).not.toHaveBeenCalled();

    setDemoMode(false);
    requestStreams('live-id', DETAIL_STREAM_TYPES);
    expect(engine.syncActivityStreams).toHaveBeenCalledWith(
      'live-id',
      [...DETAIL_STREAM_TYPES].sort().join(',')
    );
  });
});
