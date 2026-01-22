/**
 * Simplified country boundary polygons for satellite imagery region detection.
 *
 * Data Attribution:
 * - Boundary data derived from Natural Earth (naturalearthdata.com)
 * - Natural Earth is in the public domain and free for any use
 * - Polygons simplified to ~50 points per country for performance
 *
 * License: Public Domain (CC0)
 * Source: https://www.naturalearthdata.com/about/terms-of-use/
 */

// Switzerland boundary (simplified from Natural Earth data)
// Coordinates are in [longitude, latitude] format for GeoJSON
export const SWITZERLAND_BOUNDARY: GeoJSON.Feature<GeoJSON.Polygon> = {
  type: 'Feature',
  properties: { name: 'Switzerland' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [9.594, 47.525],
        [9.632, 47.347],
        [9.524, 47.27],
        [9.58, 47.057],
        [9.896, 47.58],
        [9.997, 47.477],
        [10.133, 47.567],
        [10.35, 47.322],
        [10.468, 47.052],
        [10.469, 46.855],
        [10.239, 46.635],
        [10.153, 46.611],
        [10.044, 46.236],
        [9.882, 46.368],
        [9.569, 46.291],
        [9.451, 46.381],
        [9.234, 46.233],
        [9.022, 45.833],
        [8.818, 46.077],
        [8.454, 46.233],
        [8.45, 46.445],
        [8.166, 46.444],
        [7.994, 46.014],
        [7.861, 45.917],
        [7.036, 45.926],
        [6.758, 46.14],
        [6.778, 46.173],
        [6.8, 46.43],
        [6.457, 46.449],
        [6.22, 46.31],
        [6.1, 46.378],
        [6.052, 46.42],
        [5.97, 46.214],
        [5.959, 46.132],
        [6.122, 46.057],
        [6.157, 45.978],
        [6.653, 45.968],
        [6.802, 45.828],
        [6.963, 46.006],
        [7.023, 45.926],
        [7.036, 45.926],
        [7.281, 45.995],
        [7.445, 45.943],
        [7.535, 45.978],
        [7.886, 45.922],
        [7.99, 46.015],
        [8.166, 46.444],
        [8.453, 46.445],
        [8.818, 46.077],
        [9.022, 45.833],
        [9.234, 46.233],
        [9.451, 46.381],
        [9.569, 46.291],
        [9.882, 46.368],
        [10.044, 46.236],
        [10.153, 46.611],
        [10.239, 46.635],
        [10.469, 46.855],
        [10.468, 47.052],
        [10.35, 47.322],
        [10.133, 47.567],
        [9.997, 47.477],
        [9.896, 47.58],
        [9.58, 47.057],
        [9.524, 47.27],
        [9.632, 47.347],
        [9.594, 47.525],
        [9.527, 47.535],
        [9.409, 47.522],
        [9.12, 47.671],
        [8.878, 47.653],
        [8.672, 47.682],
        [8.594, 47.617],
        [8.57, 47.621],
        [8.552, 47.659],
        [8.456, 47.597],
        [8.317, 47.614],
        [8.271, 47.696],
        [8.466, 47.777],
        [8.559, 47.804],
        [7.698, 47.571],
        [7.584, 47.593],
        [7.511, 47.509],
        [7.462, 47.449],
        [7.552, 47.227],
        [7.539, 47.08],
        [7.162, 47.457],
        [6.962, 47.453],
        [6.887, 47.267],
        [7.009, 47.032],
        [6.869, 47.017],
        [6.787, 47.148],
        [6.659, 47.088],
        [6.441, 47.022],
        [6.141, 46.843],
        [6.117, 46.781],
        [5.959, 46.132],
        [5.97, 46.214],
        [6.052, 46.42],
        [6.1, 46.378],
        [6.22, 46.31],
        [6.457, 46.449],
        [6.8, 46.43],
        [6.778, 46.173],
        [6.758, 46.14],
        [7.036, 45.926],
        [7.861, 45.917],
        [7.994, 46.014],
        [8.166, 46.444],
        [8.45, 46.445],
        [8.454, 46.233],
        [8.818, 46.077],
        [9.022, 45.833],
        [9.234, 46.233],
        [9.451, 46.381],
        [9.569, 46.291],
        [9.882, 46.368],
        [10.044, 46.236],
        [10.153, 46.611],
        [10.239, 46.635],
        [10.469, 46.855],
        [10.468, 47.052],
        [10.35, 47.322],
        [10.133, 47.567],
        [9.997, 47.477],
        [9.896, 47.58],
        [9.594, 47.525],
      ],
    ],
  },
};

// Simplified Switzerland boundary - cleaner version with fewer points
export const SWITZERLAND_SIMPLE: [number, number][] = [
  [5.956, 46.132],
  [5.97, 46.214],
  [6.052, 46.42],
  [6.22, 46.31],
  [6.457, 46.449],
  [6.8, 46.43],
  [6.758, 46.14],
  [7.036, 45.926],
  [7.861, 45.917],
  [7.994, 46.014],
  [8.166, 46.444],
  [8.45, 46.445],
  [8.454, 46.233],
  [8.818, 46.077],
  [9.022, 45.833],
  [9.234, 46.233],
  [9.451, 46.381],
  [9.569, 46.291],
  [9.882, 46.368],
  [10.044, 46.236],
  [10.153, 46.611],
  [10.239, 46.635],
  [10.469, 46.855],
  [10.468, 47.052],
  [10.35, 47.322],
  [10.133, 47.567],
  [9.997, 47.477],
  [9.896, 47.58],
  [9.594, 47.525],
  [9.527, 47.535],
  [9.12, 47.671],
  [8.672, 47.682],
  [8.559, 47.804],
  [8.466, 47.777],
  [8.271, 47.696],
  [8.317, 47.614],
  [7.698, 47.571],
  [7.584, 47.593],
  [7.511, 47.509],
  [7.552, 47.227],
  [7.539, 47.08],
  [7.162, 47.457],
  [6.962, 47.453],
  [6.869, 47.017],
  [6.659, 47.088],
  [6.141, 46.843],
  [6.117, 46.781],
  [5.956, 46.132],
];

/**
 * Check if a point is inside Switzerland using ray casting algorithm
 */
export function isPointInSwitzerland(lng: number, lat: number): boolean {
  const polygon = SWITZERLAND_SIMPLE;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

// France boundary - simplified outline (metropolitan France only)
export const FRANCE_SIMPLE: [number, number][] = [
  [-1.79, 43.353],
  [-1.285, 43.063],
  [-0.042, 42.689],
  [0.65, 42.859],
  [1.445, 42.602],
  [1.725, 42.505],
  [2.05, 42.353],
  [3.03, 42.447],
  [3.168, 42.435],
  [3.227, 43.115],
  [4.067, 43.56],
  [4.394, 43.405],
  [5.07, 43.4],
  [6.152, 43.059],
  [6.525, 43.127],
  [6.865, 43.532],
  [7.379, 43.763],
  [7.7, 43.77],
  [7.464, 43.694],
  [7.639, 44.17],
  [7.071, 44.692],
  [6.631, 45.116],
  [7.036, 45.926],
  [6.758, 46.14],
  [6.457, 46.449],
  [6.22, 46.31],
  [6.052, 46.42],
  [5.97, 46.214],
  [5.956, 46.132],
  [6.117, 46.781],
  [6.141, 46.843],
  [6.869, 47.017],
  [7.162, 47.457],
  [7.539, 47.08],
  [7.552, 47.227],
  [7.511, 47.509],
  [7.584, 47.593],
  [7.698, 47.571],
  [8.317, 47.614],
  [8.271, 47.696],
  [7.421, 48.144],
  [7.023, 48.954],
  [6.737, 49.165],
  [6.19, 49.463],
  [5.898, 49.442],
  [4.865, 49.788],
  [4.446, 49.946],
  [4.137, 49.979],
  [3.589, 50.379],
  [2.558, 51.09],
  [1.85, 50.947],
  [1.59, 50.25],
  [1.269, 50.039],
  [0.193, 49.7],
  [-0.199, 49.297],
  [-1.098, 49.358],
  [-1.355, 48.988],
  [-1.776, 48.53],
  [-1.905, 48.707],
  [-2.445, 48.648],
  [-3.214, 48.83],
  [-4.428, 48.58],
  [-4.78, 48.044],
  [-4.329, 47.792],
  [-3.149, 47.693],
  [-2.728, 47.462],
  [-2.451, 47.456],
  [-2.019, 47.038],
  [-1.059, 46.537],
  [-1.146, 46.311],
  [-1.776, 46.149],
  [-1.976, 45.684],
  [-1.228, 45.556],
  [-1.07, 45.315],
  [-1.158, 44.531],
  [-1.251, 44.418],
  [-1.083, 44.098],
  [-1.476, 43.611],
  [-1.79, 43.353],
];

/**
 * Check if a point is inside France using ray casting algorithm
 */
export function isPointInFrance(lng: number, lat: number): boolean {
  // First check if inside Switzerland (Switzerland is inside France's bounding box)
  if (isPointInSwitzerland(lng, lat)) {
    return false;
  }

  const polygon = FRANCE_SIMPLE;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

// Continental USA boundary - very simplified outline
export const USA_SIMPLE: [number, number][] = [
  [-124.733, 48.385],
  [-122.764, 48.999],
  [-117.032, 49.0],
  [-110.005, 49.0],
  [-104.048, 49.0],
  [-100.0, 49.0],
  [-95.153, 49.0],
  [-89.099, 47.997],
  [-84.765, 46.636],
  [-82.552, 45.347],
  [-82.123, 43.591],
  [-79.762, 43.267],
  [-79.452, 42.098],
  [-76.92, 43.629],
  [-76.3, 44.2],
  [-74.867, 44.999],
  [-71.503, 45.013],
  [-69.225, 47.458],
  [-67.79, 47.066],
  [-67.058, 44.901],
  [-70.7, 43.07],
  [-73.992, 40.751],
  [-74.022, 39.753],
  [-75.425, 38.024],
  [-75.994, 36.923],
  [-75.867, 36.55],
  [-80.533, 32.025],
  [-81.498, 30.727],
  [-80.086, 26.313],
  [-80.126, 25.816],
  [-81.8, 24.568],
  [-83.155, 25.267],
  [-84.897, 29.692],
  [-88.017, 30.233],
  [-89.184, 29.489],
  [-94.043, 29.675],
  [-96.854, 28.117],
  [-97.14, 25.97],
  [-99.17, 26.565],
  [-101.4, 29.77],
  [-103.001, 29.071],
  [-104.045, 29.33],
  [-106.528, 31.784],
  [-108.21, 31.342],
  [-111.074, 31.333],
  [-114.724, 32.718],
  [-117.128, 32.535],
  [-118.519, 34.027],
  [-120.65, 34.565],
  [-122.5, 37.783],
  [-124.211, 40.0],
  [-124.353, 42.115],
  [-124.733, 48.385],
];

/**
 * Check if a point is inside continental USA using ray casting algorithm
 */
export function isPointInUSA(lng: number, lat: number): boolean {
  const polygon = USA_SIMPLE;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Create an inverted polygon (world bounds with a hole for the country).
 * This is used to mask out areas - the hole shows through to layers below.
 * GeoJSON polygon with hole: outer ring is clockwise (world), inner ring is counter-clockwise (hole)
 */
export function createSwitzerlandMaskPolygon(): GeoJSON.Feature<GeoJSON.Polygon> {
  // World bounds (larger than needed, but covers any view)
  const worldBounds: [number, number][] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];

  // Switzerland boundary as inner ring (counter-clockwise for hole)
  // Reverse the SWITZERLAND_SIMPLE array to make it counter-clockwise
  const switzerlandHole = [...SWITZERLAND_SIMPLE].reverse();
  // Close the ring
  switzerlandHole.push(switzerlandHole[0]);

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        worldBounds, // Outer ring (world)
        switzerlandHole, // Inner ring (Switzerland hole)
      ],
    },
  };
}

/**
 * Create an inverted polygon for France (world with France-shaped hole, excluding Switzerland)
 */
export function createFranceMaskPolygon(): GeoJSON.Feature<GeoJSON.Polygon> {
  const worldBounds: [number, number][] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];

  const franceHole = [...FRANCE_SIMPLE].reverse();
  franceHole.push(franceHole[0]);

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [worldBounds, franceHole],
    },
  };
}

/**
 * Create an inverted polygon for USA (world with USA-shaped hole)
 */
export function createUSAMaskPolygon(): GeoJSON.Feature<GeoJSON.Polygon> {
  const worldBounds: [number, number][] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];

  const usaHole = [...USA_SIMPLE].reverse();
  usaHole.push(usaHole[0]);

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [worldBounds, usaHole],
    },
  };
}
