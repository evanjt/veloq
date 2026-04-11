import React, { useMemo, useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { navigateTo, formatFileSize, estimateRoutesDatabaseSize } from '@/lib';
import { getLastBackupTimestamp } from '@/lib/backup';
import { useRouteSettings } from '@/providers';
import { useTileCacheStore } from '@/providers/TileCacheStore';
import { getTerrainPreviewCacheSize } from '@/lib/storage/terrainPreviewCache';
import { getHeatmapTilesCacheSize, HEATMAP_TILES_DIR } from '@/hooks/maps/useHeatmapTiles';
import { getRouteEngine } from '@/lib/native/routeEngine';
import {
  requestTileCacheStats,
  onTileCacheStats,
  type TileCacheStats,
} from '@/lib/events/terrainSnapshotEvents';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles, DIVIDER_INSET } from './settingsStyles';

export function DataSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const {
    settings: routeSettings,
    setEnabled: setRouteMatchingEnabled,
    setHeatmapEnabled,
  } = useRouteSettings();

  // Lightweight cache size computation
  const nativeSizeEstimate = useTileCacheStore((s) => s.nativeSizeEstimate);
  const [terrainCacheSize, setTerrainCacheSize] = useState(0);
  const [heatmapCacheSize, setHeatmapCacheSize] = useState(0);
  const [tileCacheStats, setTileCacheStats] = useState<TileCacheStats | null>(null);
  const [routesSize, setRoutesSize] = useState(0);

  useEffect(() => {
    getTerrainPreviewCacheSize().then(setTerrainCacheSize);
    getHeatmapTilesCacheSize().then(setHeatmapCacheSize);
    estimateRoutesDatabaseSize().then(setRoutesSize);
  }, []);

  useEffect(() => {
    const unsub = onTileCacheStats(setTileCacheStats);
    requestTileCacheStats();
    return unsub;
  }, []);

  const totalCacheSize =
    nativeSizeEstimate +
    terrainCacheSize +
    heatmapCacheSize +
    (tileCacheStats?.totalBytes ?? 0) +
    routesSize;

  // Backup summary
  const lastBackupText = useMemo(() => {
    const ts = getLastBackupTimestamp();
    if (!ts) return t('backup.lastBackupNever');
    return new Date(ts).toLocaleDateString();
  }, [t]);

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.dataCache').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {/* Backup summary row */}
        <TouchableOpacity
          style={settingsStyles.actionRow}
          onPress={() => navigateTo('/backup-settings')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="cloud-sync-outline"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
            {t('backup.autoBackup')}
          </Text>
          <Text style={[styles.summaryValue, isDark && settingsStyles.textMuted]}>
            {lastBackupText}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>

        <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />

        {/* Cache summary row */}
        <TouchableOpacity
          style={settingsStyles.actionRow}
          onPress={() => navigateTo('/cache-settings')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="database-outline"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
            {t('settings.cacheAndDatabase', 'Cache & Database')}
          </Text>
          <Text style={[styles.summaryValue, isDark && settingsStyles.textMuted]}>
            {formatFileSize(totalCacheSize)}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>

        <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />

        {/* Route matching toggle */}
        <View style={settingsStyles.actionRow}>
          <MaterialCommunityIcons
            name="map-marker-path"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
            {t('settings.routeMatching')}
          </Text>
          <Switch
            value={routeSettings.enabled}
            onValueChange={setRouteMatchingEnabled}
            color={colors.primary}
          />
        </View>

        {/* Geocoding toggle hidden — Nominatim Usage Policy prohibits periodic app requests
           without a proxy. Will re-enable once we have a caching proxy (Cloudflare worker or
           self-hosted Nominatim). See: https://operations.osmfoundation.org/policies/nominatim/ */}

        <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />

        {/* Heatmap generation toggle */}
        <View style={settingsStyles.actionRow}>
          <MaterialCommunityIcons
            name="map-legend"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <View style={styles.toggleTextContainer}>
            <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
              {t('settings.heatmapGeneration', 'Heatmap')}
            </Text>
            <Text style={[styles.toggleHint, isDark && settingsStyles.textMuted]}>
              {t('settings.heatmapDescription', 'Uses device storage. Disable to save space.')}
            </Text>
          </View>
          <Switch
            value={routeSettings.heatmapEnabled}
            onValueChange={(enabled) => {
              setHeatmapEnabled(enabled);
              if (enabled) {
                getRouteEngine()?.enableHeatmapTiles();
              } else {
                getRouteEngine()?.clearHeatmapTiles(HEATMAP_TILES_DIR);
                getRouteEngine()?.disableHeatmapTiles();
              }
            }}
            color={colors.primary}
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  summaryValue: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
