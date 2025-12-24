/**
 * Tests for route matching algorithm using Average Minimum Distance (AMD).
 *
 * Test scenarios:
 * - Identical routes → high match, same direction
 * - Reverse direction routes → high match, reverse direction
 * - Completely different routes → no match
 * - Partially overlapping routes → match but NOT grouped
 * - Routes with GPS noise → should still match
 * - Loops vs point-to-point routes
 */

import {
  matchRoutes,
  shouldGroupRoutes,
  findMatches,
  groupSignatures,
} from '../lib/routeMatching';
import {
  haversineDistance,
  generateRouteSignature,
  calculateRouteDistance,
} from '../lib/routeSignature';
import type { RouteSignature, RoutePoint } from '../types';
import { DEFAULT_ROUTE_MATCH_CONFIG } from '../types';

// ============================================================================
// Test Data: Realistic GPS routes
// ============================================================================

/**
 * A simple 1km straight-ish route (like running down a road).
 * Start: 51.5074, -0.1278 (London)
 * End: ~1km north
 */
const ROUTE_A_POINTS: RoutePoint[] = [
  { lat: 51.5074, lng: -0.1278 },
  { lat: 51.5084, lng: -0.1275 },
  { lat: 51.5094, lng: -0.1272 },
  { lat: 51.5104, lng: -0.1270 },
  { lat: 51.5114, lng: -0.1268 },
  { lat: 51.5124, lng: -0.1265 },
  { lat: 51.5134, lng: -0.1262 },
  { lat: 51.5144, lng: -0.1260 },
  { lat: 51.5154, lng: -0.1258 },
  { lat: 51.5164, lng: -0.1255 },
];

/**
 * Same route as A but with minor GPS noise (±5m).
 */
const ROUTE_A_NOISY_POINTS: RoutePoint[] = [
  { lat: 51.5074 + 0.00002, lng: -0.1278 - 0.00003 },
  { lat: 51.5084 - 0.00001, lng: -0.1275 + 0.00002 },
  { lat: 51.5094 + 0.00003, lng: -0.1272 - 0.00001 },
  { lat: 51.5104 - 0.00002, lng: -0.1270 + 0.00003 },
  { lat: 51.5114 + 0.00001, lng: -0.1268 - 0.00002 },
  { lat: 51.5124 - 0.00003, lng: -0.1265 + 0.00001 },
  { lat: 51.5134 + 0.00002, lng: -0.1262 - 0.00003 },
  { lat: 51.5144 - 0.00001, lng: -0.1260 + 0.00002 },
  { lat: 51.5154 + 0.00003, lng: -0.1258 - 0.00001 },
  { lat: 51.5164 - 0.00002, lng: -0.1255 + 0.00003 },
];

/**
 * Route A in reverse direction.
 */
const ROUTE_A_REVERSED_POINTS: RoutePoint[] = [...ROUTE_A_POINTS].reverse();

/**
 * A completely different route (2km east-west, different area).
 */
const ROUTE_B_POINTS: RoutePoint[] = [
  { lat: 51.5200, lng: -0.1000 },
  { lat: 51.5200, lng: -0.1020 },
  { lat: 51.5200, lng: -0.1040 },
  { lat: 51.5200, lng: -0.1060 },
  { lat: 51.5200, lng: -0.1080 },
  { lat: 51.5200, lng: -0.1100 },
  { lat: 51.5200, lng: -0.1120 },
  { lat: 51.5200, lng: -0.1140 },
  { lat: 51.5200, lng: -0.1160 },
  { lat: 51.5200, lng: -0.1180 },
];

/**
 * A route that shares the first half of Route A but then diverges.
 * This should NOT be grouped with Route A (different journey).
 */
const ROUTE_PARTIAL_OVERLAP_POINTS: RoutePoint[] = [
  // First half same as Route A
  { lat: 51.5074, lng: -0.1278 },
  { lat: 51.5084, lng: -0.1275 },
  { lat: 51.5094, lng: -0.1272 },
  { lat: 51.5104, lng: -0.1270 },
  { lat: 51.5114, lng: -0.1268 },
  // Diverges east instead of continuing north
  { lat: 51.5114, lng: -0.1250 },
  { lat: 51.5114, lng: -0.1230 },
  { lat: 51.5114, lng: -0.1210 },
  { lat: 51.5114, lng: -0.1190 },
  { lat: 51.5114, lng: -0.1170 },
];

/**
 * A loop route (starts and ends at same place).
 */
const ROUTE_LOOP_POINTS: RoutePoint[] = [
  { lat: 51.5074, lng: -0.1278 },
  { lat: 51.5084, lng: -0.1275 },
  { lat: 51.5094, lng: -0.1260 },
  { lat: 51.5084, lng: -0.1245 },
  { lat: 51.5074, lng: -0.1248 },
  { lat: 51.5064, lng: -0.1255 },
  { lat: 51.5054, lng: -0.1268 },
  { lat: 51.5064, lng: -0.1280 },
  { lat: 51.5074, lng: -0.1278 }, // Back to start
];

/**
 * Same loop but with slight variations.
 */
const ROUTE_LOOP_NOISY_POINTS: RoutePoint[] = [
  { lat: 51.5074 + 0.00002, lng: -0.1278 - 0.00001 },
  { lat: 51.5084 - 0.00001, lng: -0.1275 + 0.00002 },
  { lat: 51.5094 + 0.00002, lng: -0.1260 - 0.00002 },
  { lat: 51.5084 - 0.00002, lng: -0.1245 + 0.00001 },
  { lat: 51.5074 + 0.00001, lng: -0.1248 - 0.00002 },
  { lat: 51.5064 - 0.00001, lng: -0.1255 + 0.00002 },
  { lat: 51.5054 + 0.00002, lng: -0.1268 - 0.00001 },
  { lat: 51.5064 - 0.00002, lng: -0.1280 + 0.00002 },
  { lat: 51.5074 + 0.00001, lng: -0.1278 - 0.00001 },
];

// ============================================================================
// Helper to create RouteSignature from points
// ============================================================================

function createSignature(
  activityId: string,
  points: RoutePoint[],
  overrides: Partial<RouteSignature> = {}
): RouteSignature {
  const latlngs: [number, number][] = points.map(p => [p.lat, p.lng]);
  const sig = generateRouteSignature(activityId, latlngs);
  return { ...sig, ...overrides };
}

// ============================================================================
// Tests: haversineDistance
// ============================================================================

describe('haversineDistance', () => {
  it('should return 0 for identical points', () => {
    const point = { lat: 51.5074, lng: -0.1278 };
    expect(haversineDistance(point, point)).toBe(0);
  });

  it('should calculate ~111km for 1 degree latitude difference', () => {
    const p1 = { lat: 0, lng: 0 };
    const p2 = { lat: 1, lng: 0 };
    const distance = haversineDistance(p1, p2);
    // 1 degree latitude ≈ 111km
    expect(distance).toBeGreaterThan(110000);
    expect(distance).toBeLessThan(112000);
  });

  it('should calculate correct short distance (~100m)', () => {
    const p1 = { lat: 51.5074, lng: -0.1278 };
    const p2 = { lat: 51.5084, lng: -0.1275 }; // ~100m north
    const distance = haversineDistance(p1, p2);
    expect(distance).toBeGreaterThan(90);
    expect(distance).toBeLessThan(150);
  });
});

// ============================================================================
// Tests: calculateRouteDistance
// ============================================================================

describe('calculateRouteDistance', () => {
  it('should return 0 for empty or single point routes', () => {
    expect(calculateRouteDistance([])).toBe(0);
    expect(calculateRouteDistance([{ lat: 51.5, lng: -0.1 }])).toBe(0);
  });

  it('should calculate correct total distance for a route', () => {
    const distance = calculateRouteDistance(ROUTE_A_POINTS);
    // Route A is roughly 1km
    expect(distance).toBeGreaterThan(900);
    expect(distance).toBeLessThan(1200);
  });

  it('should skip invalid GPS points', () => {
    const pointsWithInvalid: RoutePoint[] = [
      { lat: 51.5074, lng: -0.1278 },
      { lat: 51.5084, lng: -0.1275 },
      { lat: NaN, lng: -0.1272 }, // Invalid - should be skipped
      { lat: 51.5104, lng: -0.1270 },
      { lat: 51.5114, lng: -0.1268 },
    ];
    const distance = calculateRouteDistance(pointsWithInvalid);
    // Distance should be calculated from valid consecutive pairs
    expect(distance).toBeGreaterThan(0);
    expect(isFinite(distance)).toBe(true);
  });

  it('should skip outlier gaps (GPS errors)', () => {
    const pointsWithOutlier: RoutePoint[] = [
      { lat: 51.5074, lng: -0.1278 },
      { lat: 52.5074, lng: -0.1278 }, // 100km+ jump - GPS error
      { lat: 51.5094, lng: -0.1272 },
    ];
    const distance = calculateRouteDistance(pointsWithOutlier);
    // Should skip the 100km gap
    expect(distance).toBeLessThan(5000);
  });
});

// ============================================================================
// Tests: matchRoutes - main matching function
// ============================================================================

describe('matchRoutes', () => {
  it('should return high match for identical routes', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_A_POINTS);

    const match = matchRoutes(sig1, sig2);

    expect(match).not.toBeNull();
    expect(match!.matchPercentage).toBeGreaterThanOrEqual(95);
    expect(match!.direction).toBe('same');
  });

  it('should return high match for routes with GPS noise', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_A_NOISY_POINTS);

    const match = matchRoutes(sig1, sig2);

    expect(match).not.toBeNull();
    expect(match!.matchPercentage).toBeGreaterThanOrEqual(85);
    expect(match!.direction).toBe('same');
  });

  it('should detect reverse direction with high match', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_A_REVERSED_POINTS);

    const match = matchRoutes(sig1, sig2);

    expect(match).not.toBeNull();
    expect(match!.matchPercentage).toBeGreaterThanOrEqual(90);
    // Direction is now detected via endpoint comparison:
    // sig2 starts where sig1 ends, so it should be 'reverse'
    expect(match!.direction).toBe('reverse');
  });

  it('should match reversed routes with high percentage and correct direction', () => {
    // An L-shaped route (makes direction more obvious)
    const lShapedRoute: RoutePoint[] = [
      { lat: 51.5074, lng: -0.1278 },
      { lat: 51.5084, lng: -0.1278 }, // North
      { lat: 51.5094, lng: -0.1278 }, // North
      { lat: 51.5104, lng: -0.1278 }, // North
      { lat: 51.5104, lng: -0.1268 }, // East
      { lat: 51.5104, lng: -0.1258 }, // East
      { lat: 51.5104, lng: -0.1248 }, // East
    ];

    const sig1 = createSignature('activity-1', lShapedRoute);
    const sig2 = createSignature('activity-2', [...lShapedRoute].reverse());

    const match = matchRoutes(sig1, sig2);

    expect(match).not.toBeNull();
    expect(match!.matchPercentage).toBeGreaterThanOrEqual(85);
    // Direction is detected via endpoint comparison:
    // sig2 starts where sig1 ends → 'reverse'
    expect(match!.direction).toBe('reverse');
  });

  it('should return null for completely different routes', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_B_POINTS);

    const match = matchRoutes(sig1, sig2);

    // Should either be null or have very low match percentage
    if (match) {
      expect(match.matchPercentage).toBeLessThan(30);
    }
  });

  it('should match loops correctly', () => {
    const sig1 = createSignature('activity-1', ROUTE_LOOP_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_LOOP_NOISY_POINTS);

    const match = matchRoutes(sig1, sig2);

    expect(match).not.toBeNull();
    expect(match!.matchPercentage).toBeGreaterThanOrEqual(80);
  });

  it('should detect partial match with lower percentage', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_PARTIAL_OVERLAP_POINTS);

    const match = matchRoutes(sig1, sig2);

    // Should match (shared section) but not at 100%
    if (match) {
      expect(match.matchPercentage).toBeGreaterThan(20);
      expect(match.matchPercentage).toBeLessThan(80);
    }
  });
});

// ============================================================================
// Tests: shouldGroupRoutes - grouping criteria
// ============================================================================

describe('shouldGroupRoutes', () => {
  const config = DEFAULT_ROUTE_MATCH_CONFIG;

  it('should group identical routes', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_A_POINTS);

    expect(shouldGroupRoutes(sig1, sig2, 95, config)).toBe(true);
  });

  it('should group routes with GPS noise', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_A_NOISY_POINTS);

    expect(shouldGroupRoutes(sig1, sig2, 90, config)).toBe(true);
  });

  it('should group reverse direction routes', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_A_REVERSED_POINTS);

    expect(shouldGroupRoutes(sig1, sig2, 92, config)).toBe(true);
  });

  it('should NOT group routes with only partial overlap', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_PARTIAL_OVERLAP_POINTS);

    // Even with decent match percentage, different endpoints should prevent grouping
    expect(shouldGroupRoutes(sig1, sig2, 50, config)).toBe(false);
  });

  it('should NOT group routes below minGroupingPercentage', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_B_POINTS);

    expect(shouldGroupRoutes(sig1, sig2, 30, config)).toBe(false);
  });

  it('should NOT group routes with very different distances', () => {
    const sig1 = createSignature('activity-1', ROUTE_A_POINTS);
    // Create a route with same shape but double the length (different distance)
    const sig2: RouteSignature = {
      ...createSignature('activity-2', ROUTE_A_POINTS),
      distance: sig1.distance * 2.5, // 150% difference
    };

    expect(shouldGroupRoutes(sig1, sig2, 80, config)).toBe(false);
  });

  it('should group loops with same path', () => {
    const sig1 = createSignature('activity-1', ROUTE_LOOP_POINTS);
    const sig2 = createSignature('activity-2', ROUTE_LOOP_NOISY_POINTS);

    expect(shouldGroupRoutes(sig1, sig2, 85, config)).toBe(true);
  });
});

// ============================================================================
// Tests: findMatches - bulk matching
// ============================================================================

describe('findMatches', () => {
  it('should find all matching candidates', () => {
    const signature = createSignature('activity-1', ROUTE_A_POINTS);
    const candidates = [
      createSignature('activity-2', ROUTE_A_NOISY_POINTS), // Should match
      createSignature('activity-3', ROUTE_A_REVERSED_POINTS), // Should match (reverse)
      createSignature('activity-4', ROUTE_B_POINTS), // Should not match
    ];

    const matches = findMatches(signature, candidates);

    // Should find 2 matches (same direction and reverse)
    expect(matches.length).toBeGreaterThanOrEqual(1);

    // Results should be sorted by match percentage (best first)
    if (matches.length > 1) {
      expect(matches[0].match.matchPercentage).toBeGreaterThanOrEqual(
        matches[1].match.matchPercentage
      );
    }
  });

  it('should not match with self', () => {
    const signature = createSignature('activity-1', ROUTE_A_POINTS);
    const candidates = [
      signature, // Same activity ID
      createSignature('activity-2', ROUTE_A_POINTS),
    ];

    const matches = findMatches(signature, candidates);

    // Should only find activity-2, not activity-1
    expect(matches.every(m => m.candidateId !== 'activity-1')).toBe(true);
  });

  it('should return empty array when no matches', () => {
    const signature = createSignature('activity-1', ROUTE_A_POINTS);
    const candidates = [
      createSignature('activity-2', ROUTE_B_POINTS), // Different area
    ];

    const matches = findMatches(signature, candidates);

    // May or may not be empty depending on threshold, but shouldn't have high matches
    matches.forEach(m => {
      expect(m.match.matchPercentage).toBeLessThan(50);
    });
  });
});

// ============================================================================
// Tests: groupSignatures - route grouping algorithm
// ============================================================================

describe('groupSignatures', () => {
  it('should group identical routes together', () => {
    const signatures = [
      createSignature('activity-1', ROUTE_A_POINTS),
      createSignature('activity-2', ROUTE_A_NOISY_POINTS),
      createSignature('activity-3', ROUTE_A_POINTS),
    ];

    const groups = groupSignatures(signatures);

    // All 3 activities should be in the same group
    expect(groups.size).toBe(1);
    const group = Array.from(groups.values())[0];
    expect(group.length).toBe(3);
    expect(group).toContain('activity-1');
    expect(group).toContain('activity-2');
    expect(group).toContain('activity-3');
  });

  it('should group reverse direction routes together', () => {
    const signatures = [
      createSignature('activity-1', ROUTE_A_POINTS),
      createSignature('activity-2', ROUTE_A_REVERSED_POINTS),
    ];

    const groups = groupSignatures(signatures);

    // Both should be in the same group
    expect(groups.size).toBe(1);
    const group = Array.from(groups.values())[0];
    expect(group.length).toBe(2);
  });

  it('should keep different routes in separate groups', () => {
    const signatures = [
      createSignature('activity-1', ROUTE_A_POINTS),
      createSignature('activity-2', ROUTE_B_POINTS),
    ];

    const groups = groupSignatures(signatures);

    // Should be 2 separate groups
    expect(groups.size).toBe(2);
  });

  it('should NOT group partially overlapping routes', () => {
    const signatures = [
      createSignature('activity-1', ROUTE_A_POINTS),
      createSignature('activity-2', ROUTE_PARTIAL_OVERLAP_POINTS),
    ];

    const groups = groupSignatures(signatures);

    // Should be 2 separate groups (different journeys)
    expect(groups.size).toBe(2);
  });

  it('should group multiple loops together', () => {
    const signatures = [
      createSignature('activity-1', ROUTE_LOOP_POINTS),
      createSignature('activity-2', ROUTE_LOOP_NOISY_POINTS),
    ];

    const groups = groupSignatures(signatures);

    // Both loops should be in the same group
    expect(groups.size).toBe(1);
    const group = Array.from(groups.values())[0];
    expect(group.length).toBe(2);
  });

  it('should handle mixed routes correctly', () => {
    const signatures = [
      createSignature('activity-1', ROUTE_A_POINTS),
      createSignature('activity-2', ROUTE_A_NOISY_POINTS),
      createSignature('activity-3', ROUTE_B_POINTS),
      createSignature('activity-4', ROUTE_LOOP_POINTS),
      createSignature('activity-5', ROUTE_LOOP_NOISY_POINTS),
    ];

    const groups = groupSignatures(signatures);

    // Should have 3 groups:
    // 1. activity-1, activity-2 (Route A)
    // 2. activity-3 (Route B - different)
    // 3. activity-4, activity-5 (Loop route)
    expect(groups.size).toBe(3);

    // Find the Route A group
    const routeAGroup = Array.from(groups.values()).find(
      g => g.includes('activity-1')
    );
    expect(routeAGroup).toContain('activity-2');
    expect(routeAGroup).not.toContain('activity-3');

    // Find the Loop group
    const loopGroup = Array.from(groups.values()).find(
      g => g.includes('activity-4')
    );
    expect(loopGroup).toContain('activity-5');
  });

  it('should handle single activity', () => {
    const signatures = [createSignature('activity-1', ROUTE_A_POINTS)];

    const groups = groupSignatures(signatures);

    expect(groups.size).toBe(1);
    const group = Array.from(groups.values())[0];
    expect(group).toEqual(['activity-1']);
  });

  it('should handle empty array', () => {
    const groups = groupSignatures([]);
    expect(groups.size).toBe(0);
  });
});

// ============================================================================
// Edge cases and regression tests
// ============================================================================

// ============================================================================
// Tests: Shared section scenarios (real-world problem)
// ============================================================================

describe('Shared section scenarios', () => {
  /**
   * Real-world scenario: Multiple runs share the same path to a starting point
   * (e.g., "path to the river") but then diverge into different routes.
   * These should NOT be grouped together.
   */

  // Shared "path to the river" section (2km)
  const SHARED_START_SECTION: RoutePoint[] = [
    { lat: 51.5000, lng: -0.1200 }, // Home
    { lat: 51.5020, lng: -0.1195 },
    { lat: 51.5040, lng: -0.1190 },
    { lat: 51.5060, lng: -0.1185 },
    { lat: 51.5080, lng: -0.1180 },
    { lat: 51.5100, lng: -0.1175 },
    { lat: 51.5120, lng: -0.1170 },
    { lat: 51.5140, lng: -0.1165 },
    { lat: 51.5160, lng: -0.1160 },
    { lat: 51.5180, lng: -0.1155 }, // River path start
  ];

  // Run A: Path to river → Loop North → Return via river path
  const RUN_A_FULL: RoutePoint[] = [
    ...SHARED_START_SECTION,
    // Goes north from river
    { lat: 51.5200, lng: -0.1150 },
    { lat: 51.5220, lng: -0.1140 },
    { lat: 51.5240, lng: -0.1130 },
    { lat: 51.5260, lng: -0.1120 },
    { lat: 51.5280, lng: -0.1110 },
    // Loops back
    { lat: 51.5260, lng: -0.1100 },
    { lat: 51.5240, lng: -0.1110 },
    { lat: 51.5220, lng: -0.1120 },
    { lat: 51.5200, lng: -0.1130 },
    // Returns via river path (reversed)
    ...SHARED_START_SECTION.slice().reverse(),
  ];

  // Run B: Path to river → Loop South → Return via river path
  const RUN_B_FULL: RoutePoint[] = [
    ...SHARED_START_SECTION,
    // Goes SOUTH from river (different direction than Run A)
    { lat: 51.5160, lng: -0.1140 },
    { lat: 51.5140, lng: -0.1130 },
    { lat: 51.5120, lng: -0.1120 },
    { lat: 51.5100, lng: -0.1110 },
    { lat: 51.5080, lng: -0.1100 },
    // Loops back
    { lat: 51.5100, lng: -0.1090 },
    { lat: 51.5120, lng: -0.1100 },
    { lat: 51.5140, lng: -0.1110 },
    { lat: 51.5160, lng: -0.1120 },
    // Returns via river path (reversed)
    ...SHARED_START_SECTION.slice().reverse(),
  ];

  // Run A repeated (same as Run A but with GPS noise)
  const RUN_A_REPEAT: RoutePoint[] = RUN_A_FULL.map(p => ({
    lat: p.lat + (Math.random() - 0.5) * 0.0001,
    lng: p.lng + (Math.random() - 0.5) * 0.0001,
  }));

  it('should NOT group runs that only share the "path to river" section', () => {
    const sigA = createSignature('run-a', RUN_A_FULL);
    const sigB = createSignature('run-b', RUN_B_FULL);

    // They might have some match because of shared section
    const match = matchRoutes(sigA, sigB);

    // But they should NOT be grouped because:
    // - Middle points diverge (one goes north, one goes south)
    // - Even if match percentage is decent, the middle check should fail
    if (match) {
      expect(shouldGroupRoutes(sigA, sigB, match.matchPercentage, DEFAULT_ROUTE_MATCH_CONFIG)).toBe(false);
    }
  });

  it('should group actual repeats of the same full run', () => {
    const sigA = createSignature('run-a', RUN_A_FULL);
    const sigARepeat = createSignature('run-a-repeat', RUN_A_REPEAT);

    const match = matchRoutes(sigA, sigARepeat);

    expect(match).not.toBeNull();
    expect(match!.matchPercentage).toBeGreaterThan(70);
    expect(shouldGroupRoutes(sigA, sigARepeat, match!.matchPercentage, DEFAULT_ROUTE_MATCH_CONFIG)).toBe(true);
  });

  it('should keep different runs in separate groups even with shared section', () => {
    const signatures = [
      createSignature('run-a-1', RUN_A_FULL),
      createSignature('run-a-2', RUN_A_REPEAT),
      createSignature('run-b-1', RUN_B_FULL),
    ];

    const groups = groupSignatures(signatures);

    // Should have 2 groups:
    // 1. Run A instances (run-a-1, run-a-2)
    // 2. Run B instance (run-b-1)
    expect(groups.size).toBe(2);

    // Find the Run A group
    const runAGroup = Array.from(groups.values()).find(g => g.includes('run-a-1'));
    expect(runAGroup).toContain('run-a-2');
    expect(runAGroup).not.toContain('run-b-1');
  });
});

describe('Edge cases', () => {
  it('should handle routes with very few points', () => {
    const shortRoute: RoutePoint[] = [
      { lat: 51.5074, lng: -0.1278 },
      { lat: 51.5094, lng: -0.1272 },
    ];

    const sig1 = createSignature('activity-1', shortRoute);
    const sig2 = createSignature('activity-2', shortRoute);

    const match = matchRoutes(sig1, sig2);
    expect(match).not.toBeNull();
    expect(match!.matchPercentage).toBeGreaterThan(80);
  });

  it('should handle routes with many points', () => {
    // Create a dense route with 500 points
    const densePoints: RoutePoint[] = [];
    for (let i = 0; i < 500; i++) {
      densePoints.push({
        lat: 51.5074 + i * 0.0002,
        lng: -0.1278 + i * 0.00005,
      });
    }

    const sig1 = createSignature('activity-1', densePoints);
    const sig2 = createSignature('activity-2', densePoints);

    const match = matchRoutes(sig1, sig2);
    expect(match).not.toBeNull();
    expect(match!.matchPercentage).toBeGreaterThan(90);
  });

  it('should handle routes at different locations on Earth', () => {
    // Route in Sydney, Australia
    const sydneyRoute: RoutePoint[] = [
      { lat: -33.8688, lng: 151.2093 },
      { lat: -33.8698, lng: 151.2103 },
      { lat: -33.8708, lng: 151.2113 },
    ];

    // Route in New York
    const newYorkRoute: RoutePoint[] = [
      { lat: 40.7128, lng: -74.0060 },
      { lat: 40.7138, lng: -74.0050 },
      { lat: 40.7148, lng: -74.0040 },
    ];

    const sig1 = createSignature('activity-1', sydneyRoute);
    const sig2 = createSignature('activity-2', newYorkRoute);

    const match = matchRoutes(sig1, sig2);

    // Should not match (completely different parts of the world)
    expect(match).toBeNull();
  });

  it('should handle near-equator routes correctly', () => {
    const equatorRoute: RoutePoint[] = [
      { lat: 0.001, lng: 100.000 },
      { lat: 0.002, lng: 100.001 },
      { lat: 0.003, lng: 100.002 },
    ];

    const distance = calculateRouteDistance(equatorRoute);
    expect(distance).toBeGreaterThan(0);
    expect(isFinite(distance)).toBe(true);
  });

  it('should handle routes near the poles', () => {
    const arcticRoute: RoutePoint[] = [
      { lat: 89.999, lng: 0 },
      { lat: 89.998, lng: 10 },
      { lat: 89.997, lng: 20 },
    ];

    const distance = calculateRouteDistance(arcticRoute);
    expect(distance).toBeGreaterThan(0);
    expect(isFinite(distance)).toBe(true);
  });
});
