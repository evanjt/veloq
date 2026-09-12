import { useState, useEffect, useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { getEngine } from '@/shared/native/engine';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { decodeCoords } from 'veloqrs';

import { createCoalescer } from '@/shared/async/coalesceRefresh';

/**
 * How long a burst of `activities` events is allowed to collect before the
 * second rebuild. A GPS backfill announces once per batch, and each rebuild
 * reads and decodes every row, so this is the difference between two passes
 * over the table and one per batch.
 */
const REFRESH_WINDOW_MS = 400;

export interface RouteSignature {
  points: { lat: number; lng: number }[];
  center: { lat: number; lng: number };
}

/**
 * Hook to get route signatures from the Rust engine.
 *
 * Uses a single batch FFI call (getAllMapSignatures) to fetch simplified signatures
 * (~100 points each via Douglas-Peucker) instead of individual getGpsTrack() calls
 * (~5,000 points each). This reduces memory from ~250MB to ~5MB for 1,000 activities.
 *
 * PERFORMANCE: Defers loading until after animations complete to avoid blocking
 * UI, and coalesces `activities` events so a sync burst costs two rebuilds
 * rather than one per event. Each rebuild reads every `signatures` row, decodes
 * the blob in Rust, re-encodes it for the bridge and decodes it again here.
 *
 * @param enabled - Whether to load signatures (default: true). Set to false when the
 *   map tab is not focused to release memory.
 * @returns Record mapping activityId to {points, center}
 */
export function useRouteSignatures(enabled = true): Record<string, RouteSignature> {
  const [signatures, setSignatures] = useState<Record<string, RouteSignature>>({});
  const isMountedRef = useRef(true);

  const buildSignatures = useCallback(() => {
    if (!enabled) return;
    const engine = getEngine();
    if (!engine || !isMountedRef.current) return;

    try {
      // Single FFI call returns all simplified signatures (~100 pts each)
      const mapSignatures = engine.getAllMapSignatures();
      const sigs: Record<string, RouteSignature> = {};

      for (const sig of mapSignatures) {
        const decoded = decodeCoords(sig.encodedCoords);
        if (decoded.length < 2) continue; // Need at least 2 points

        const points = decoded.map((p) => ({ lat: p.latitude, lng: p.longitude }));

        sigs[sig.activityId] = {
          points,
          center: { lat: sig.centerLat, lng: sig.centerLng },
        };
      }

      if (isMountedRef.current) {
        setSignatures(sigs);
      }
    } catch {
      if (isMountedRef.current) {
        setSignatures({});
      }
    }
  }, [enabled]);

  // Clear signatures when disabled (releases memory on tab switch). Dropping
  // them while rendering means the disabled tab never commits a frame still
  // holding them.
  const [signaturesFor, setSignaturesFor] = useState(enabled);
  if (enabled !== signaturesFor) {
    setSignaturesFor(enabled);
    if (!enabled) setSignatures({});
  }

  const engine = useEngineReady();
  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) return undefined;

    let unsubscribe: (() => void) | null = null;
    let task: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

    if (!engine) return undefined;

    // Defer loading until after navigation animations complete
    task = InteractionManager.runAfterInteractions(() => {
      buildSignatures();
    });

    // Every rebuild reads the whole table, so a burst is coalesced rather than
    // answered event by event.
    const coalescer = createCoalescer(buildSignatures, REFRESH_WINDOW_MS, (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });
    unsubscribe = engine.subscribe('activities', coalescer.request);

    return () => {
      isMountedRef.current = false;
      task?.cancel();
      coalescer.cancel();
      unsubscribe?.();
    };
  }, [buildSignatures, enabled, engine]);

  return signatures;
}
