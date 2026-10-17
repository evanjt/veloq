/**
 * useVisibilityToggles - grouped state for map overlay visibility toggles.
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
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import { useHeatmapPreference } from '../stores/HeatmapPreferenceStore';

interface UseVisibilityTogglesResult {
  // State
  showActivities: boolean;
  showHeatmap: boolean;
  showSections: boolean;
  showRoutes: boolean;
  is3DMode: boolean;

  // Setters (kept explicit - useMapHandlers, useEffects, and error boundaries
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
  // The layers menu's checks are kept by the map layer preference store, so they survive a remount.
  const showActivities = useHeatmapPreference((s) => s.activitiesVisible);
  const setActivitiesVisible = useHeatmapPreference((s) => s.setActivitiesVisible);
  const setShowActivities: Dispatch<SetStateAction<boolean>> = useCallback(
    (next) => {
      const current = useHeatmapPreference.getState().activitiesVisible;
      setActivitiesVisible(typeof next === 'function' ? next(current) : next);
    },
    [setActivitiesVisible]
  );
  const showHeatmap = useHeatmapPreference((s) => s.heatmapVisible);
  const setHeatmapVisible = useHeatmapPreference((s) => s.setHeatmapVisible);
  const setShowHeatmap: Dispatch<SetStateAction<boolean>> = useCallback(
    (next) => {
      const current = useHeatmapPreference.getState().heatmapVisible;
      setHeatmapVisible(typeof next === 'function' ? next(current) : next);
    },
    [setHeatmapVisible]
  );
  const showSections = useHeatmapPreference((s) => s.sectionsVisible);
  const setSectionsVisible = useHeatmapPreference((s) => s.setSectionsVisible);
  const setShowSections: Dispatch<SetStateAction<boolean>> = useCallback(
    (next) => {
      const current = useHeatmapPreference.getState().sectionsVisible;
      setSectionsVisible(typeof next === 'function' ? next(current) : next);
    },
    [setSectionsVisible]
  );
  // Kept by the map layer preference store: the map screen reads it too, to ask the engine for the lines.
  const showRoutes = useHeatmapPreference((s) => s.routesVisible);
  const setVisible = useHeatmapPreference((s) => s.setRoutesVisible);
  const setShowRoutes: Dispatch<SetStateAction<boolean>> = useCallback(
    (next) => {
      const current = useHeatmapPreference.getState().routesVisible;
      setVisible(typeof next === 'function' ? next(current) : next);
    },
    [setVisible]
  );
  const [is3DMode, setIs3DMode] = useState(false);

  const toggleHeatmap = useCallback(() => {
    setShowHeatmap((current) => !current);
  }, [setShowHeatmap]);

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
