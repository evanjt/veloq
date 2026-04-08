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
    setGeocodingEnabled,
  } = useRouteSettings();

  // Lightweight cache size computation
  const { nativeSizeEstimate } = useTileCacheStore();
  const [terrainCacheSize, setTerrainCacheSize] = useState(0);
  const [tileCacheStats, setTileCacheStats] = useState<TileCacheStats | null>(null);
  const [routesSize, setRoutesSize] = useState(0);

  useEffect(() => {
    getTerrainPreviewCacheSize().then(setTerrainCacheSize);
    estimateRoutesDatabaseSize().then(setRoutesSize);
  }, []);

  useEffect(() => {
    const unsub = onTileCacheStats(setTileCacheStats);
    requestTileCacheStats();
    return unsub;
  }, []);

  const totalCacheSize =
    nativeSizeEstimate + terrainCacheSize + (tileCacheStats?.totalBytes ?? 0) + routesSize;

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
            {t('settings.cache', 'Cache')}
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

        <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />

        {/* Geocoding toggle - uses OpenStreetMap Nominatim for reverse geocoding */}
        <View style={settingsStyles.actionRow}>
          <MaterialCommunityIcons
            name="map-search-outline"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <View style={styles.toggleTextContainer}>
            <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
              {t('settings.geocoding')}
            </Text>
            <Text style={[styles.toggleHint, isDark && settingsStyles.textMuted]}>
              {t('settings.geocodingDescription')}
            </Text>
          </View>
          <Switch
            value={routeSettings.geocodingEnabled}
            onValueChange={setGeocodingEnabled}
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
