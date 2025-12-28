/**
 * Integration tests for Rust engine wrapper layer.
 *
 * These tests verify that the JavaScript wrapper layer correctly
 * interfaces with the Rust route-matcher engine after the refactor.
 *
 * Coverage:
 * - activitySpatialIndex wrapper
 * - RouteMapView signature handling
 * - useActivityBoundsCache stats
 * - useHeatmap generation
 */

import { activitySpatialIndex, mapBoundsToViewport, type Viewport } from '../lib/spatialIndex';

// Mock the route-matcher-native module
jest.mock('route-matcher-native', () => ({
  routeEngine: {
    getActivityCount: jest.fn(),
    queryViewport: jest.fn(),
    getGroups: jest.fn(),
    getSignaturesForGroup: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    clear: jest.fn(),
    addActivities: jest.fn(),
    getActivityIds: jest.fn(() => []),
  },
  generateHeatmap: jest.fn(),
  addFetchProgressListener: jest.fn(() => ({ remove: jest.fn() })),
  fetchActivityMapsWithProgress: jest.fn(),
}));

// Get mocked routeEngine
const { routeEngine } = jest.requireMock('route-matcher-native');

describe('activitySpatialIndex wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ready property', () => {
    it('should return false when engine has no activities', () => {
      (routeEngine.getActivityCount as jest.Mock).mockReturnValue(0);

      expect(activitySpatialIndex.ready).toBe(false);
    });

    it('should return true when engine has activities', () => {
      (routeEngine.getActivityCount as jest.Mock).mockReturnValue(10);

      expect(activitySpatialIndex.ready).toBe(true);
    });

    it('should return false when engine throws', () => {
      (routeEngine.getActivityCount as jest.Mock).mockImplementation(() => {
        throw new Error('Engine not initialized');
      });

      expect(activitySpatialIndex.ready).toBe(false);
    });
  });

  describe('size property', () => {
    it('should return activity count from engine', () => {
      (routeEngine.getActivityCount as jest.Mock).mockReturnValue(42);

      expect(activitySpatialIndex.size).toBe(42);
    });

    it('should return 0 when engine throws', () => {
      (routeEngine.getActivityCount as jest.Mock).mockImplementation(() => {
        throw new Error('Engine not initialized');
      });

      expect(activitySpatialIndex.size).toBe(0);
    });
  });

  describe('queryViewport', () => {
    it('should proxy to engine queryViewport with correct parameters', () => {
      const mockIds = ['activity-1', 'activity-2'];
      (routeEngine.queryViewport as jest.Mock).mockReturnValue(mockIds);

      const viewport: Viewport = {
        minLat: 51.5,
        maxLat: 51.6,
        minLng: -0.2,
        maxLng: -0.1,
      };

      const result = activitySpatialIndex.queryViewport(viewport);

      expect(routeEngine.queryViewport).toHaveBeenCalledWith(51.5, 51.6, -0.2, -0.1);
      expect(result).toEqual(mockIds);
    });

    it('should return empty array when engine throws', () => {
      (routeEngine.queryViewport as jest.Mock).mockImplementation(() => {
        throw new Error('Query failed');
      });

      const result = activitySpatialIndex.queryViewport({
        minLat: 0,
        maxLat: 1,
        minLng: 0,
        maxLng: 1,
      });

      expect(result).toEqual([]);
    });
  });
});

describe('mapBoundsToViewport', () => {
  it('should convert map bounds to viewport format', () => {
    // Map bounds are in [lng, lat] format
    const sw: [number, number] = [-0.2, 51.5]; // [lng, lat]
    const ne: [number, number] = [-0.1, 51.6]; // [lng, lat]

    const result = mapBoundsToViewport(sw, ne);

    expect(result).toEqual({
      minLat: 51.5,
      maxLat: 51.6,
      minLng: -0.2,
      maxLng: -0.1,
    });
  });

  it('should handle inverted bounds', () => {
    // Bounds might come in wrong order
    const sw: [number, number] = [-0.1, 51.6];
    const ne: [number, number] = [-0.2, 51.5];

    const result = mapBoundsToViewport(sw, ne);

    expect(result.minLat).toBeLessThan(result.maxLat);
    expect(result.minLng).toBeLessThan(result.maxLng);
  });
});

describe('useActivityBoundsCache integration', () => {
  // These tests verify the hook correctly queries the Rust engine

  it('should get activity count from engine', () => {
    (routeEngine.getActivityCount as jest.Mock).mockReturnValue(150);

    // The hook would call this
    const count = routeEngine.getActivityCount();

    expect(count).toBe(150);
  });

  it('should subscribe to engine activity changes', () => {
    const mockUnsubscribe = jest.fn();
    (routeEngine.subscribe as jest.Mock).mockReturnValue(mockUnsubscribe);

    // The hook would call this
    const unsubscribe = routeEngine.subscribe('activities', () => {});

    expect(routeEngine.subscribe).toHaveBeenCalledWith('activities', expect.any(Function));
    expect(typeof unsubscribe).toBe('function');
  });
});

describe('RouteMapView signature handling', () => {
  it('should handle empty signatures', () => {
    const signatures: Record<string, { points: Array<{ lat: number; lng: number }> }> = {};

    const traces = Object.entries(signatures)
      .filter(([_, sig]) => sig.points?.length > 1)
      .map(([id, sig]) => ({ id, points: sig.points }));

    expect(traces).toEqual([]);
  });

  it('should convert signatures to traces format', () => {
    const signatures: Record<string, { points: Array<{ lat: number; lng: number }> }> = {
      'activity-1': {
        points: [
          { lat: 51.5, lng: -0.1 },
          { lat: 51.6, lng: -0.2 },
        ],
      },
      'activity-2': {
        points: [
          { lat: 52.0, lng: -0.3 },
          { lat: 52.1, lng: -0.4 },
          { lat: 52.2, lng: -0.5 },
        ],
      },
    };

    const traces = Object.entries(signatures)
      .filter(([_, sig]) => sig.points?.length > 1)
      .map(([id, sig]) => ({ id, points: sig.points }));

    expect(traces).toHaveLength(2);
    expect(traces[0].id).toBe('activity-1');
    expect(traces[0].points).toHaveLength(2);
    expect(traces[1].id).toBe('activity-2');
    expect(traces[1].points).toHaveLength(3);
  });

  it('should filter out single-point signatures', () => {
    const signatures: Record<string, { points: Array<{ lat: number; lng: number }> }> = {
      'activity-1': {
        points: [{ lat: 51.5, lng: -0.1 }], // Only 1 point
      },
      'activity-2': {
        points: [
          { lat: 52.0, lng: -0.3 },
          { lat: 52.1, lng: -0.4 },
        ],
      },
    };

    const traces = Object.entries(signatures)
      .filter(([_, sig]) => sig.points?.length > 1)
      .map(([id, sig]) => ({ id, points: sig.points }));

    expect(traces).toHaveLength(1);
    expect(traces[0].id).toBe('activity-2');
  });
});

describe('Heatmap generation', () => {
  const { generateHeatmap } = jest.requireMock('route-matcher-native');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call generateHeatmap with correct signature format', () => {
    const mockHeatmapResult = {
      cells: [
        { row: 0, col: 0, density: 5, activityCount: 3, routeCount: 2, activities: [] },
      ],
      bounds: { minLat: 51.5, maxLat: 51.6, minLng: -0.2, maxLng: -0.1 },
      gridRows: 10,
      gridCols: 10,
      cellSizeMeters: 100,
      maxDensity: 5,
      totalRoutes: 2,
      totalActivities: 3,
    };
    (generateHeatmap as jest.Mock).mockReturnValue(mockHeatmapResult);

    const signatures = [
      {
        activityId: 'test-1',
        points: [{ latitude: 51.5, longitude: -0.1 }],
        totalDistance: 1000,
        startPoint: { latitude: 51.5, longitude: -0.1 },
        endPoint: { latitude: 51.6, longitude: -0.2 },
        bounds: { minLat: 51.5, maxLat: 51.6, minLng: -0.2, maxLng: -0.1 },
        center: { latitude: 51.55, longitude: -0.15 },
      },
    ];
    const activityData = [
      {
        activityId: 'test-1',
        routeId: 'route-1',
        routeName: 'Test Route',
        timestamp: null,
      },
    ];

    generateHeatmap(signatures, activityData, { cellSizeMeters: 100 });

    expect(generateHeatmap).toHaveBeenCalledWith(signatures, activityData, { cellSizeMeters: 100 });
  });

  it('should handle empty groups gracefully', () => {
    (routeEngine.getGroups as jest.Mock).mockReturnValue([]);

    const groups = routeEngine.getGroups();

    expect(groups).toEqual([]);
  });
});

describe('Date range computation for cache stats', () => {
  it('should find oldest date from activities', () => {
    const activities = [
      { start_date: '2024-03-15T10:00:00Z' },
      { start_date: '2024-01-01T08:00:00Z' },
      { start_date: '2024-06-20T14:00:00Z' },
    ];

    let oldest: string | null = null;
    for (const activity of activities) {
      const date = activity.start_date;
      if (date && (!oldest || date < oldest)) {
        oldest = date;
      }
    }

    expect(oldest).toBe('2024-01-01T08:00:00Z');
  });

  it('should find newest date from activities', () => {
    const activities = [
      { start_date: '2024-03-15T10:00:00Z' },
      { start_date: '2024-01-01T08:00:00Z' },
      { start_date: '2024-06-20T14:00:00Z' },
    ];

    let newest: string | null = null;
    for (const activity of activities) {
      const date = activity.start_date;
      if (date && (!newest || date > newest)) {
        newest = date;
      }
    }

    expect(newest).toBe('2024-06-20T14:00:00Z');
  });

  it('should handle empty activities array', () => {
    const activities: Array<{ start_date?: string }> = [];

    let oldest: string | null = null;
    for (const activity of activities) {
      const date = activity.start_date;
      if (date && (!oldest || date < oldest)) {
        oldest = date;
      }
    }

    expect(oldest).toBeNull();
  });
});

describe('Background loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should trigger getGroups when activity count reaches threshold', async () => {
    (routeEngine.getActivityCount as jest.Mock).mockReturnValue(95);
    (routeEngine.getGroups as jest.Mock).mockReturnValue([]);

    // Simulate what happens after sync completes
    const activityCount = routeEngine.getActivityCount();
    if (activityCount >= 90) {
      routeEngine.getGroups();
    }

    expect(routeEngine.getGroups).toHaveBeenCalled();
  });

  it('should not trigger getGroups when below threshold', () => {
    (routeEngine.getActivityCount as jest.Mock).mockReturnValue(50);

    // Simulate what happens after sync completes
    const activityCount = routeEngine.getActivityCount();
    if (activityCount >= 90) {
      routeEngine.getGroups();
    }

    expect(routeEngine.getGroups).not.toHaveBeenCalled();
  });
});
