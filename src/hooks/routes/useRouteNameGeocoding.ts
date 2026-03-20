import { useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateRouteName } from '@/lib/geo/geocoding';
import { getRouteEngine } from '@/lib/native/routeEngine';

const GEOCODED_IDS_KEY = 'veloq-geocoded-route-ids';
const GEOCODED_SECTION_IDS_KEY = 'veloq-geocoded-section-ids';

/**
 * Background geocoding for routes and sections with generic "Route N" / "Section N" names.
 * Runs after the list renders and geocodes items one at a time (1 req/sec Nominatim policy).
 * Saves the result via engine.setRouteName() / engine.setSectionName().
 * Tracks processed IDs in AsyncStorage to avoid re-processing.
 */
export function useRouteNameGeocoding(enabled: boolean = true) {
  const runningRef = useRef(false);

  const geocodeRoutes = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      const engine = getRouteEngine();
      if (!engine) return;

      // Load already-geocoded IDs
      const [routeIdsRaw, sectionIdsRaw] = await Promise.all([
        AsyncStorage.getItem(GEOCODED_IDS_KEY),
        AsyncStorage.getItem(GEOCODED_SECTION_IDS_KEY),
      ]);
      const geocodedRouteIds = new Set<string>(routeIdsRaw ? JSON.parse(routeIdsRaw) : []);
      const geocodedSectionIds = new Set<string>(sectionIdsRaw ? JSON.parse(sectionIdsRaw) : []);

      // Get route groups with generic names
      const routePattern =
        /^(Route|Ruta|Itinéraire|Strecke|Percorso|Rota|Trasa|Rutt|ルート|路线) \d+$/;
      const sectionPattern =
        /^(Section|Sección|Tronçon|Abschnitt|Sezione|Trecho|Odcinek|Sektion|セクション|路段) \d+$/;

      // Process routes
      const { summaries: groups } = engine.getGroupSummaries();
      const routesToGeocode = groups
        .filter((g) => {
          if (geocodedRouteIds.has(g.groupId)) return false;
          const name = g.customName;
          return name && routePattern.test(name);
        })
        .slice(0, 5); // Max 5 per session

      for (const group of routesToGeocode) {
        try {
          const consensus = engine.getConsensusRoute(group.groupId);
          if (!consensus?.length || consensus.length < 2) {
            geocodedRouteIds.add(group.groupId);
            continue;
          }

          const startLat = consensus[0].latitude;
          const startLng = consensus[0].longitude;
          const endLat = consensus[consensus.length - 1].latitude;
          const endLng = consensus[consensus.length - 1].longitude;

          // Detect loop: start/end within ~200m
          const dist = Math.sqrt(
            Math.pow((endLat - startLat) * 111000, 2) +
              Math.pow((endLng - startLng) * 111000 * Math.cos((startLat * Math.PI) / 180), 2)
          );
          const isLoop = dist < 200;

          const name = await generateRouteName(startLat, startLng, endLat, endLng, isLoop);
          if (name) {
            engine.setRouteName(group.groupId, name);
          }
          geocodedRouteIds.add(group.groupId);

          // Rate limit: 1 req/sec
          await new Promise((r) => setTimeout(r, 1100));
        } catch {
          geocodedRouteIds.add(group.groupId);
        }
      }

      // Process sections
      const summaries = engine.getSectionSummaries();
      const sectionsToGeocode = summaries.summaries
        .filter((s) => {
          if (geocodedSectionIds.has(s.id)) return false;
          const name = s.name;
          return name && sectionPattern.test(name);
        })
        .slice(0, 5); // Max 5 per session

      for (const section of sectionsToGeocode) {
        try {
          const polyline = engine.getSectionPolyline(section.id);
          if (!polyline?.length || polyline.length < 4) {
            geocodedSectionIds.add(section.id);
            continue;
          }

          const startLat = polyline[0].latitude;
          const startLng = polyline[0].longitude;
          const endLat = polyline[polyline.length - 1].latitude;
          const endLng = polyline[polyline.length - 1].longitude;

          const dist = Math.sqrt(
            Math.pow((endLat - startLat) * 111000, 2) +
              Math.pow((endLng - startLng) * 111000 * Math.cos((startLat * Math.PI) / 180), 2)
          );
          const isLoop = dist < 200;

          const name = await generateRouteName(startLat, startLng, endLat, endLng, isLoop);
          if (name) {
            engine.setSectionName(section.id, name);
          }
          geocodedSectionIds.add(section.id);

          // Rate limit: 1 req/sec
          await new Promise((r) => setTimeout(r, 1100));
        } catch {
          geocodedSectionIds.add(section.id);
        }
      }

      // Persist processed IDs
      await Promise.all([
        AsyncStorage.setItem(GEOCODED_IDS_KEY, JSON.stringify([...geocodedRouteIds])),
        AsyncStorage.setItem(GEOCODED_SECTION_IDS_KEY, JSON.stringify([...geocodedSectionIds])),
      ]);
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Delay start to let the UI settle
    const timer = setTimeout(geocodeRoutes, 3000);
    return () => clearTimeout(timer);
  }, [enabled, geocodeRoutes]);
}
