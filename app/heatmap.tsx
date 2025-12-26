/**
 * Heatmap screen.
 * Displays an interactive heatmap of activity density with route intelligence.
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapView, Camera } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, shadows } from '@/theme';
import { useHeatmap, type CellQueryResult } from '@/hooks/useHeatmap';
import { HeatmapLayer, HeatmapCellPopup } from '@/components/maps';
import { useRouteMatchStore } from '@/providers';
import {
  type MapStyleType,
  getMapStyle,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
  MAP_ATTRIBUTIONS,
} from '@/components/maps/mapStyles';

// Cell size options
const CELL_SIZES = [
  { label: '50m', value: 50 },
  { label: '100m', value: 100 },
  { label: '200m', value: 200 },
];

export default function HeatmapScreen() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = colorScheme === 'dark' ? 'dark' : 'light';
  const [mapStyle, setMapStyle] = useState<MapStyleType>(systemStyle);
  const [cellSize, setCellSize] = useState(100);
  const [selectedCell, setSelectedCell] = useState<CellQueryResult | null>(null);
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);

  const isDark = isDarkStyle(mapStyle);
  const mapStyleValue = getMapStyle(mapStyle);

  // Check if we have any data
  const hasData = useRouteMatchStore((s) => Object.keys(s.cache?.signatures ?? {}).length > 0);

  // Generate heatmap
  const { heatmap, isReady, queryCell } = useHeatmap({ cellSizeMeters: cellSize });

  // Calculate initial bounds from heatmap
  const initialBounds = useMemo(() => {
    if (!heatmap || heatmap.cells.length === 0) return null;
    return {
      ne: [heatmap.bounds.maxLng, heatmap.bounds.maxLat] as [number, number],
      sw: [heatmap.bounds.minLng, heatmap.bounds.minLat] as [number, number],
    };
  }, [heatmap]);

  // Handle cell tap
  const handleCellPress = useCallback((row: number, col: number) => {
    if (!heatmap) return;

    // Find the cell
    const cell = heatmap.cells.find(c => c.row === row && c.col === col);
    if (!cell) return;

    // Query for full result
    const result = queryCell(cell.centerLat, cell.centerLng);
    setSelectedCell(result);
  }, [heatmap, queryCell]);

  // Close popup
  const handleClosePopup = useCallback(() => {
    setSelectedCell(null);
  }, []);

  // Handle route press
  const handleRoutePress = useCallback((routeId: string) => {
    router.push(`/route/${routeId}`);
    setSelectedCell(null);
  }, []);

  // Toggle map style
  const toggleStyle = useCallback(() => {
    setMapStyle(current => getNextStyle(current));
  }, []);

  // Cycle cell size
  const cycleCellSize = useCallback(() => {
    const currentIndex = CELL_SIZES.findIndex(s => s.value === cellSize);
    const nextIndex = (currentIndex + 1) % CELL_SIZES.length;
    setCellSize(CELL_SIZES[nextIndex].value);
    setSelectedCell(null); // Clear selection when changing cell size
  }, [cellSize]);

  // Show empty state if no data
  if (!hasData) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Heatmap</Text>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-marker-off"
            size={64}
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            No Activity Data
          </Text>
          <Text style={[styles.emptyText, isDark && styles.textMuted]}>
            Process some activities in the Routes screen first to generate a heatmap.
          </Text>
          <TouchableOpacity
            style={styles.emptyButton}
            onPress={() => router.push('/routes')}
          >
            <Text style={styles.emptyButtonText}>Go to Routes</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapStyle={mapStyleValue}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onPress={handleClosePopup}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={initialBounds ? {
            bounds: initialBounds,
            padding: { paddingTop: 100, paddingRight: 40, paddingBottom: 200, paddingLeft: 40 },
          } : undefined}
          animationDuration={0}
        />

        {/* Heatmap layer */}
        {isReady && heatmap && (
          <HeatmapLayer
            heatmap={heatmap}
            onCellPress={handleCellPress}
            opacity={0.75}
            highlightCommonPaths={true}
          />
        )}
      </MapView>

      {/* Header */}
      <View style={[styles.headerOverlay, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={[styles.button, isDark && styles.buttonDark]}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons
            name="close"
            size={24}
            color={isDark ? '#FFFFFF' : '#333333'}
          />
        </TouchableOpacity>

        <View style={[styles.titleBadge, isDark && styles.titleBadgeDark]}>
          <MaterialCommunityIcons
            name="fire"
            size={18}
            color={colors.primary}
          />
          <Text style={[styles.titleText, isDark && styles.textLight]}>
            Heatmap
          </Text>
          {heatmap && (
            <Text style={[styles.statsBadge, isDark && styles.textMuted]}>
              {heatmap.totalActivities} activities
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, isDark && styles.buttonDark]}
          onPress={toggleStyle}
        >
          <MaterialCommunityIcons
            name={getStyleIcon(mapStyle)}
            size={24}
            color={isDark ? '#FFFFFF' : '#333333'}
          />
        </TouchableOpacity>
      </View>

      {/* Controls */}
      <View style={[styles.controlStack, { top: insets.top + 72 }]}>
        {/* Cell size toggle */}
        <TouchableOpacity
          style={[styles.controlButton, isDark && styles.controlButtonDark]}
          onPress={cycleCellSize}
        >
          <Text style={[styles.controlButtonText, isDark && styles.textLight]}>
            {CELL_SIZES.find(s => s.value === cellSize)?.label}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Attribution */}
      <View style={[styles.attribution, { bottom: insets.bottom + 8 }]}>
        <Text style={styles.attributionText}>{MAP_ATTRIBUTIONS[mapStyle]}</Text>
      </View>

      {/* Cell popup */}
      {selectedCell && (
        <View style={[styles.popup, { bottom: insets.bottom + 40 }]}>
          <HeatmapCellPopup
            cellResult={selectedCell}
            onClose={handleClosePopup}
            onRoutePress={handleRoutePress}
          />
        </View>
      )}

      {/* Loading state */}
      {!isReady && hasData && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingBadge, isDark && styles.loadingBadgeDark]}>
            <MaterialCommunityIcons
              name="loading"
              size={20}
              color={colors.primary}
            />
            <Text style={[styles.loadingText, isDark && styles.textLight]}>
              Generating heatmap...
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  map: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerRight: {
    width: 48,
  },
  headerOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.mapOverlay,
  },
  buttonDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  titleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    gap: spacing.xs,
    ...shadows.mapOverlay,
  },
  titleBadgeDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  titleText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statsBadge: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  controlStack: {
    position: 'absolute',
    right: 16,
    gap: 8,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.mapOverlay,
  },
  controlButtonDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  controlButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  attribution: {
    position: 'absolute',
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  attributionText: {
    fontSize: 9,
    color: '#333333',
  },
  popup: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  emptyButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 20,
  },
  emptyButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    gap: spacing.sm,
    ...shadows.mapOverlay,
  },
  loadingBadgeDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  loadingText: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
});
