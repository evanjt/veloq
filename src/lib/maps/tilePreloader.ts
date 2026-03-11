/**
 * Satellite tile preloading utilities.
 *
 * Generates tile URLs for activity regions at z10-z13, and produces a
 * JS script that can be injected into a WebView to preload those tiles
 * into the Cache API with throttling (2 concurrent, 50ms delay).
 */

import { SATELLITE_SOURCES } from '@/components/maps/mapStyles';
import { lng2tile, lat2tile } from './tileGeometry';

interface ActivityBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Get satellite tile URLs for activity bounds at specified zoom range.
 * Uses the global EOX source (always available) for preloading.
 */
export function getSatellitePreloadUrls(
  activities: Array<{ bounds: ActivityBounds }>,
  zoomRange: [number, number] = [10, 13]
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const template = SATELLITE_SOURCES.eox.tiles[0];

  for (const { bounds } of activities) {
    for (let z = zoomRange[0]; z <= zoomRange[1]; z++) {
      const xMin = lng2tile(bounds.minLng, z);
      const xMax = lng2tile(bounds.maxLng, z);
      const yMin = lat2tile(bounds.maxLat, z); // note: lat2tile is inverted
      const yMax = lat2tile(bounds.minLat, z);

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const url = template
            .replace('{z}', String(z))
            .replace('{x}', String(x))
            .replace('{y}', String(y));
          if (!seen.has(url)) {
            seen.add(url);
            urls.push(url);
          }
        }
      }
    }
  }

  return urls;
}

/**
 * Generate JS to inject into a WebView for background satellite tile preloading.
 * Fetches tiles with throttling and caches via Cache API.
 */
export function generatePreloadScript(urls: string[], cacheName: string): string {
  const urlsJSON = JSON.stringify(urls);
  return `
    (function() {
      var urls = ${urlsJSON};
      var CACHE_NAME = '${cacheName}';
      var CONCURRENCY = 2;
      var DELAY_MS = 50;
      var idx = 0;
      var active = 0;

      caches.open(CACHE_NAME).then(function(cache) {
        function next() {
          if (idx >= urls.length && active === 0) {
            window._rn_log && window._rn_log('Preload done: ' + urls.length + ' tiles');
            return;
          }
          while (active < CONCURRENCY && idx < urls.length) {
            var url = urls[idx++];
            active++;
            cache.match(url).then(function(cached) {
              if (cached) {
                active--;
                setTimeout(next, 0);
              } else {
                return fetch(url).then(function(r) {
                  if (r.ok) cache.put(url, r);
                  active--;
                  setTimeout(next, DELAY_MS);
                }).catch(function() {
                  active--;
                  setTimeout(next, DELAY_MS);
                });
              }
            });
          }
        }
        next();
      });
    })();
    true;
  `;
}
