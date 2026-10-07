import { readBasemapTileCounts } from '../basemapCache';

const mockTileCounts = jest.fn();
let mockStore: { tileCounts: jest.Mock } | null = null;

jest.mock('veloqrs', () => ({
  basemapStore: () => {
    if (!mockStore) throw new Error('no native module');
    return mockStore;
  },
}));

describe('readBasemapTileCounts', () => {
  beforeEach(() => {
    mockTileCounts.mockReset();
    mockStore = { tileCounts: mockTileCounts };
  });

  it('returns the rows the store reports', () => {
    const rows = [{ source: 'ground', hits: 4, misses: 1, fetches: 1 }];
    mockTileCounts.mockReturnValue(rows);
    expect(readBasemapTileCounts()).toEqual(rows);
  });

  it('returns no rows when the store throws', () => {
    mockTileCounts.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(readBasemapTileCounts()).toEqual([]);
  });

  it('returns no rows where there is no native module', () => {
    mockStore = null;
    expect(readBasemapTileCounts()).toEqual([]);
  });
});
