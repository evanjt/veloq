/**
 * useVisibilityToggles — grouped state for map overlay visibility toggles.
 *
 * Consolidates the five independent visibility toggles used by RegionalMapView:
 *   - `showActivities` (activity markers + traces)
 *   - `showHeatmap` (raster heatmap)
 *   - `showSections` (frequent route sections)
 *   - `showRoutes` (route groups)
 *   - `is3DMode` (2D vs WebView 3D terrain)
 *
 * State setters are returned alongside the booleans so that downstream hooks
 * (notably `useMapHandlers`) can still drive them directly, while simple
 * inline toggles are provided via `toggle*` callbacks.
 *
 * Extracted from RegionalMapView.tsx — pure refactor, no behaviour change.
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

interface UseVisibilityTogglesResult {
  // State
  showActivities: boolean;
  showHeatmap: boolean;
  showSections: boolean;
  showRoutes: boolean;
  is3DMode: boolean;

  // Setters (kept explicit — useMapHandlers, useEffects, and error boundaries
  // drive these directly rather than only through the toggle callbacks).
  setShowActivities: Dispatch<SetStateAction<boolean>>;
  setShowHeatmap: Dispatch<SetStateAction<boolean>>;
  setShowSections: Dispatch<SetStateAction<boolean>>;
  setShowRoutes: Dispatch<SetStateAction<boolean>>;
  setIs3DMode: Dispatch<SetStateAction<boolean>>;

  // Simple boolean toggles (for control stack buttons that don't need custom logic).
  toggleHeatmap: () => void;
  toggle3D: () => void;
}

export function useVisibilityToggles(): UseVisibilityTogglesResult {
  const [showActivities, setShowActivities] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showSections, setShowSections] = useState(true);
  const [showRoutes, setShowRoutes] = useState(false);
  const [is3DMode, setIs3DMode] = useState(false);

  const toggleHeatmap = useCallback(() => {
    setShowHeatmap((current) => !current);
  }, []);

  const toggle3D = useCallback(() => {
    setIs3DMode((current) => !current);
  }, []);

  return {
    showActivities,
    showHeatmap,
    showSections,
    showRoutes,
    is3DMode,
    setShowActivities,
    setShowHeatmap,
    setShowSections,
    setShowRoutes,
    setIs3DMode,
    toggleHeatmap,
    toggle3D,
  };
}
