/**
 * Hook for generating and managing heatmap tiles from GPS tracks.
 *
 * Uses the Rust tile generation engine to create raster PNG tiles
 * that can be displayed as a MapLibre RasterSource.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import { ffiGenerateAndSaveTiles, ffiGetTileCoords } from 'veloqrs';
import type { FfiTileConfig, TileGenerationResult } from 'veloqrs';

/** Default tile configuration using app brand color - zoom 0-16 covers world view to street level */
const DEFAULT_TILE_CONFIG: FfiTileConfig = {
  lineColorR: 252,
  lineColorG: 76,
  lineColorB: 2,
  lineColorA: 180,
  lineWidth: 2.0,
  minZoom: 0,
  maxZoom: 16,
};

/** Directory for storing generated tiles - URI format for Expo FileSystem and MapLibre */
const TILES_DIRECTORY_URI = `${FileSystem.documentDirectory}heatmap-tiles`;

/** Directory as filesystem path for Rust FFI (strip file:// prefix) */
const TILES_DIRECTORY_PATH = TILES_DIRECTORY_URI.replace('file://', '');

/** Get the tile URL template for MapLibre RasterSource */
export function getTileUrlTemplate(): string {
  return `${TILES_DIRECTORY_URI}/{z}/{x}/{y}.png`;
}

interface UseHeatmapTilesOptions {
  /** Tile configuration (color, line width, zoom levels) */
  config?: Partial<FfiTileConfig>;
  /** Whether to auto-generate tiles when activity count changes */
  autoGenerate?: boolean;
}

interface TileGenerationState {
  /** Whether tile generation is in progress */
  isGenerating: boolean;
  /** Number of tiles generated so far */
  tilesGenerated: number;
  /** Total tiles to generate (0 if unknown) */
  totalTiles: number;
  /** Last error message, if any */
  error: string | null;
  /** Last generation result */
  lastResult: TileGenerationResult | null;
}

/**
 * Hook for managing heatmap tile generation.
 *
 * @example
 * ```tsx
 * const { generateTiles, state, tilesExist } = useHeatmapTiles();
 *
 * // Trigger generation
 * await generateTiles();
 *
 * // Use in MapLibre
 * <MapView>
 *   {tilesExist && (
 *     <RasterSource
 *       id="heatmap"
 *       tileUrlTemplates={[getTileUrlTemplate()]}
 *       minZoomLevel={8}
 *       maxZoomLevel={14}
 *     >
 *       <RasterLayer id="heatmap-layer" />
 *     </RasterSource>
 *   )}
 * </MapView>
 * ```
 */
export function useHeatmapTiles(options: UseHeatmapTilesOptions = {}) {
  const { config: customConfig } = options;
  const queryClient = useQueryClient();

  const config: FfiTileConfig = {
    ...DEFAULT_TILE_CONFIG,
    ...customConfig,
  };

  const [state, setState] = useState<TileGenerationState>({
    isGenerating: false,
    tilesGenerated: 0,
    totalTiles: 0,
    error: null,
    lastResult: null,
  });

  // Check if tiles directory exists
  const { data: tilesExist = false, refetch: checkTilesExist } = useQuery({
    queryKey: ['heatmap-tiles-exist'],
    queryFn: async () => {
      const info = await FileSystem.getInfoAsync(TILES_DIRECTORY_URI);
      return info.exists;
    },
    staleTime: 5000, // Check every 5 seconds at most
  });

  // Get tile coordinates that need to be generated
  const getTileCoords = useCallback(() => {
    return ffiGetTileCoords(config);
  }, [config]);

  // Mutation for tile generation
  const generateMutation = useMutation({
    mutationFn: async (): Promise<TileGenerationResult> => {
      setState((prev) => ({
        ...prev,
        isGenerating: true,
        error: null,
        tilesGenerated: 0,
        totalTiles: 0,
      }));

      // Ensure tiles directory exists (FileSystem needs URI)
      const dirInfo = await FileSystem.getInfoAsync(TILES_DIRECTORY_URI);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(TILES_DIRECTORY_URI, { intermediates: true });
      }

      // Get tile coordinates to show progress
      const coords = ffiGetTileCoords(config);
      setState((prev) => ({ ...prev, totalTiles: coords.length }));

      // Generate and save tiles in one FFI call (Rust needs path, not URI)
      const result = ffiGenerateAndSaveTiles(TILES_DIRECTORY_PATH, config);

      setState((prev) => ({
        ...prev,
        isGenerating: false,
        tilesGenerated: result.tilesSaved,
        lastResult: result,
      }));

      return result;
    },
    onError: (error: Error) => {
      setState((prev) => ({
        ...prev,
        isGenerating: false,
        error: error.message,
      }));
    },
    onSuccess: () => {
      // Invalidate tiles exist query
      queryClient.invalidateQueries({ queryKey: ['heatmap-tiles-exist'] });
    },
  });

  // Clear generated tiles
  const clearTiles = useCallback(async () => {
    const dirInfo = await FileSystem.getInfoAsync(TILES_DIRECTORY_URI);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(TILES_DIRECTORY_URI, { idempotent: true });
    }
    setState((prev) => ({
      ...prev,
      tilesGenerated: 0,
      totalTiles: 0,
      lastResult: null,
    }));
    queryClient.invalidateQueries({ queryKey: ['heatmap-tiles-exist'] });
  }, [queryClient]);

  return {
    /** Current tile generation state */
    state,
    /** Whether tiles have been generated */
    tilesExist,
    /** Generate (or regenerate) tiles */
    generateTiles: generateMutation.mutateAsync,
    /** Whether generation is in progress */
    isGenerating: generateMutation.isPending,
    /** Clear all generated tiles */
    clearTiles,
    /** Check if tiles exist (refresh) */
    checkTilesExist,
    /** Get tile coordinates without generating */
    getTileCoords,
    /** Tile configuration being used */
    config,
    /** Tiles directory URI (for external usage) */
    tilesDirectory: TILES_DIRECTORY_URI,
  };
}

/**
 * Hook for getting just the tile source configuration for MapLibre.
 * Use this in components that only need to display tiles, not generate them.
 */
export function useHeatmapTileSource() {
  const { data: tilesExist = false } = useQuery({
    queryKey: ['heatmap-tiles-exist'],
    queryFn: async () => {
      const info = await FileSystem.getInfoAsync(TILES_DIRECTORY_URI);
      return info.exists;
    },
    staleTime: 5000,
  });

  return {
    tilesExist,
    tileUrlTemplate: getTileUrlTemplate(),
    tilesDirectory: TILES_DIRECTORY_URI,
    minZoom: DEFAULT_TILE_CONFIG.minZoom,
    maxZoom: DEFAULT_TILE_CONFIG.maxZoom,
  };
}
