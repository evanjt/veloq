/**
 * useSectionAutoToggle — auto-show/hide section overlays based on map zoom.
 *
 * When the map zooms past a threshold, sections are shown; when zoomed out,
 * they are hidden. Once the user manually toggles sections, auto-behaviour is
 * disabled for the life of the component (manual wins). The actual state
 * flip is debounced (300ms) to avoid React re-renders during gesture momentum,
 * which can cause Android MapLibre to snap the camera back.
 *
 * The hook composes with the existing `handleRegionDidChange` handler from
 * `useMapHandlers` and the existing `toggleSections` callback — it wraps both
 * with the auto-toggle concern while preserving identity stability.
 *
 * Extracted from RegionalMapView.tsx — pure refactor, no behaviour change.
 */

import { useCallback, useRef } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import type { ViewStateChangeEvent } from '@maplibre/maplibre-react-native';

/** Zoom level at or above which sections are auto-shown. */
const SECTIONS_AUTO_SHOW_ZOOM = 13;
/** Zoom level below which sections are auto-hidden. */
const SECTIONS_AUTO_HIDE_ZOOM = 11;
/** Delay before applying the auto-toggle to avoid re-renders during gestures. */
const AUTO_TOGGLE_DEBOUNCE_MS = 300;

interface UseSectionAutoToggleParams {
  /** Current showSections state. */
  showSections: boolean;
  /** State setter for showSections. */
  setShowSections: (value: boolean) => void;
  /** Base region-did-change handler to compose with. */
  baseHandleRegionDidChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  /** Base toggleSections callback (from useMapHandlers). */
  baseToggleSections: () => void;
}

interface UseSectionAutoToggleResult {
  /** Wrapped region-did-change handler that also auto-toggles sections. */
  handleRegionDidChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  /** Wrapped toggleSections that marks the user as having taken manual control. */
  toggleSections: () => void;
}

export function useSectionAutoToggle({
  showSections,
  setShowSections,
  baseHandleRegionDidChange,
  baseToggleSections,
}: UseSectionAutoToggleParams): UseSectionAutoToggleResult {
  // Ref mirror for showSections — read inside handleRegionDidChange to keep
  // callback identity stable. Changing onRegionDidChange prop causes Android
  // MapLibre to re-render the native view and snap the camera back.
  const showSectionsRef = useRef(showSections);
  showSectionsRef.current = showSections;

  // Track whether user manually toggled sections (if so, don't auto-show/hide).
  const userToggledSectionsRef = useRef(false);

  // Debounce timer for auto-show/hide sections — defers setShowSections to
  // avoid React re-renders during gesture momentum that cause Android MapLibre
  // snap-back.
  const showSectionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSections = useCallback(() => {
    userToggledSectionsRef.current = true;
    baseToggleSections();
  }, [baseToggleSections]);

  // CRITICAL: Read showSections from ref (not closure) to keep callback
  // identity stable. Changing onRegionDidChange prop causes Android MapLibre to
  // re-render and snap camera back.
  const handleRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      baseHandleRegionDidChange(event);

      if (userToggledSectionsRef.current) return;

      const zoomLevel = event.nativeEvent.zoom;

      // Defer section visibility change to avoid React re-render during
      // gesture momentum. Matches the 300ms debounce used for zoom/center
      // updates in useMapHandlers.
      if (showSectionsDebounceRef.current) clearTimeout(showSectionsDebounceRef.current);
      showSectionsDebounceRef.current = setTimeout(() => {
        if (zoomLevel >= SECTIONS_AUTO_SHOW_ZOOM && !showSectionsRef.current) {
          setShowSections(true);
        } else if (zoomLevel < SECTIONS_AUTO_HIDE_ZOOM && showSectionsRef.current) {
          setShowSections(false);
        }
      }, AUTO_TOGGLE_DEBOUNCE_MS);
    },
    [baseHandleRegionDidChange, setShowSections]
  );

  return { handleRegionDidChange, toggleSections };
}
