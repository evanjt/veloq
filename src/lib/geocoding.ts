/**
 * Geocoding utilities for route naming.
 * Uses OpenStreetMap Nominatim for free reverse geocoding.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const GEOCODE_CACHE_KEY = 'veloq_geocode_cache';
const MAX_CACHE_SIZE = 500;

// In-memory cache for quick access
const memoryCache = new Map<string, string>();

interface CacheEntry {
  name: string;
  timestamp: number;
}

interface GeocodeCacheData {
  entries: Record<string, CacheEntry>;
}

/**
 * Generate a cache key for a lat/lng point.
 * Rounds to ~500m precision to group nearby points.
 */
function getCacheKey(lat: number, lng: number): string {
  const roundedLat = Math.round(lat * 200) / 200; // ~500m precision
  const roundedLng = Math.round(lng * 200) / 200;
  return `${roundedLat},${roundedLng}`;
}

/**
 * Load geocode cache from storage.
 */
async function loadCache(): Promise<GeocodeCacheData> {
  try {
    const cached = await AsyncStorage.getItem(GEOCODE_CACHE_KEY);
    if (cached) {
      const data: GeocodeCacheData = JSON.parse(cached);
      // Populate memory cache
      for (const [key, entry] of Object.entries(data.entries)) {
        memoryCache.set(key, entry.name);
      }
      return data;
    }
  } catch {
    // Ignore cache errors
  }
  return { entries: {} };
}

/**
 * Save geocode cache to storage.
 */
async function saveCache(data: GeocodeCacheData): Promise<void> {
  try {
    // Prune old entries if cache is too large
    const entries = Object.entries(data.entries);
    if (entries.length > MAX_CACHE_SIZE) {
      // Sort by timestamp and keep newest half
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      data.entries = Object.fromEntries(entries.slice(0, MAX_CACHE_SIZE / 2));
    }
    await AsyncStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore save errors
  }
}

/**
 * Extract a meaningful location name from Nominatim response.
 * Tries to get a short, recognizable name.
 */
function extractLocationName(data: {
  display_name?: string;
  address?: {
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    village?: string;
    town?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
  };
  name?: string;
}): string | null {
  const addr = data.address;
  if (!addr) return null;

  // Priority order for naming:
  // 1. Specific location (park, trail, etc.) - from display_name
  // 2. Road/street name
  // 3. Neighbourhood
  // 4. Suburb
  // 5. Village/Town
  // 6. City with qualifier

  // Check if display_name starts with a specific place name (not just address)
  if (data.name && !data.name.match(/^\d/)) {
    // Has a named location (park, trail, etc.)
    return data.name;
  }

  if (addr.road) {
    // Use road name, optionally with neighbourhood/suburb
    const qualifier = addr.neighbourhood || addr.suburb;
    if (qualifier && qualifier !== addr.road) {
      return `${addr.road}, ${qualifier}`;
    }
    return addr.road;
  }

  if (addr.neighbourhood) {
    return addr.neighbourhood;
  }

  if (addr.suburb) {
    return addr.suburb;
  }

  if (addr.village) {
    return addr.village;
  }

  if (addr.town) {
    return addr.town;
  }

  if (addr.city) {
    // City is too generic on its own, add qualifier if available
    const qualifier = addr.county || addr.state;
    if (qualifier) {
      return `${addr.city}, ${qualifier}`;
    }
    return addr.city;
  }

  return null;
}

/**
 * Reverse geocode a point to get a location name.
 * Returns a short, meaningful name for the location.
 *
 * @param lat Latitude
 * @param lng Longitude
 * @returns Location name or null if geocoding fails
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const cacheKey = getCacheKey(lat, lng);

  // Check memory cache first
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey) || null;
  }

  // Load persistent cache
  const cache = await loadCache();
  if (cache.entries[cacheKey]) {
    const name = cache.entries[cacheKey].name;
    memoryCache.set(cacheKey, name);
    return name;
  }

  try {
    // Call Nominatim API
    const url = `${NOMINATIM_BASE_URL}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Veloq/1.0 (Fitness App)',
        'Accept-Language': 'en',
      },
    });

    if (!response.ok) {
      console.warn(`[Geocoding] Nominatim returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    const name = extractLocationName(data);

    if (name) {
      // Cache the result
      memoryCache.set(cacheKey, name);
      cache.entries[cacheKey] = {
        name,
        timestamp: Date.now(),
      };
      await saveCache(cache);
    }

    return name;
  } catch (error) {
    console.warn('[Geocoding] Failed to reverse geocode:', error);
    return null;
  }
}

/**
 * Generate a descriptive route name from start and optionally end points.
 * If the route is a loop (start ~= end), just uses start location.
 * Otherwise, creates "StartLocation to EndLocation" format.
 */
export async function generateRouteName(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  isLoop: boolean
): Promise<string | null> {
  const startName = await reverseGeocode(startLat, startLng);

  if (!startName) {
    return null;
  }

  if (isLoop) {
    // For loops, just use the start location with "Loop" suffix
    return `${startName} Loop`;
  }

  // For point-to-point routes, try to get end location
  const endName = await reverseGeocode(endLat, endLng);

  if (endName && endName !== startName) {
    // Shorten if both names are long
    const maxLen = 25;
    let start = startName;
    let end = endName;

    if (start.length + end.length > maxLen * 2) {
      // Truncate to first part of each
      if (start.includes(',')) {
        start = start.split(',')[0].trim();
      }
      if (end.includes(',')) {
        end = end.split(',')[0].trim();
      }
    }

    return `${start} to ${end}`;
  }

  // Just use start location
  return startName;
}

/**
 * Clear the geocoding cache.
 */
export async function clearGeocodeCache(): Promise<void> {
  memoryCache.clear();
  try {
    await AsyncStorage.removeItem(GEOCODE_CACHE_KEY);
  } catch {
    // Ignore
  }
}
