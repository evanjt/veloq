import { useState, useEffect } from 'react';

// Lazy load native module to avoid bundler errors
let _routeEngine: typeof import('route-matcher-native').routeEngine | null = null;
function getRouteEngine() {
  if (!_routeEngine) {
    try {
      _routeEngine = require('route-matcher-native').routeEngine;
    } catch {
      return null;
    }
  }
  return _routeEngine;
}

export interface RouteSignature {
  points: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
}

/**
 * Hook to get all route signatures from the Rust engine.
 *
 * Signatures contain simplified GPS traces for rendering activity paths on maps.
 * The hook subscribes to engine activity changes and updates automatically.
 *
 * @returns Record mapping activityId to {points, center}
 */
export function useRouteSignatures(): Record<string, RouteSignature> {
  const [signatures, setSignatures] = useState<Record<string, RouteSignature>>({});

  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    const refresh = () => {
      try {
        const sigs = engine.getAllSignatures();
        setSignatures(sigs);
      } catch {
        setSignatures({});
      }
    };

    // Initial load
    refresh();

    // Subscribe to activity changes
    const unsubscribe = engine.subscribe('activities', refresh);

    return unsubscribe;
  }, []);

  return signatures;
}
