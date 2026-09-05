/**
 * The heatmap switch, on the maps spoke beside the other things the map draws.
 *
 * The size beside the toggle is the cost of the thing being switched. The same
 * number appears in the storage table, which is the inventory, and both read
 * `getHeatmapTilesCacheSize` so there is one measurement rather than two.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as FileSystem from 'expo-file-system/legacy';

import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { formatFileSize } from '@/shared/format/format';
import { HEATMAP_TILES_DIR, getHeatmapTilesCacheSize } from '@/features/maps/hooks/useHeatmapTiles';
import { useHeatmapPreference } from '@/features/maps/stores/HeatmapPreferenceStore';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

export function HeatmapRow() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const enabled = useHeatmapPreference((s) => s.enabled);
  const setEnabled = useHeatmapPreference((s) => s.setEnabled);
  const [size, setSize] = useState(0);

  const refreshSize = useCallback(() => {
    setSize(getHeatmapTilesCacheSize());
  }, []);

  useEffect(() => {
    refreshSize();
  }, [refreshSize, enabled]);

  const handleToggle = useCallback(
    (next: boolean) => {
      setEnabled(next);
      const engine = getEngine();
      if (next) {
        engine?.enableHeatmapTiles();
      } else {
        engine?.clearHeatmapTiles(HEATMAP_TILES_DIR);
        const legacyDir = `${FileSystem.documentDirectory}heatmap-tiles/`;
        engine?.clearHeatmapTiles(legacyDir);
        engine?.disableHeatmapTiles();
      }
      refreshSize();
    },
    [setEnabled, refreshSize]
  );

  return (
    <View style={settingsStyles.actionRow} testID="heatmap-row">
      <MaterialCommunityIcons
        name="map-legend"
        size={22}
        color={isDark ? darkColors.textSecondary : colors.textSecondary}
      />
      <View style={styles.textWrap}>
        <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
          {t('settings.heatmapGeneration', 'Heatmap')}
        </Text>
        <Text style={[styles.hint, isDark && settingsStyles.textMuted]}>
          {enabled && size > 0
            ? t('settings.heatmapStorageUsed', {
                defaultValue: 'Using {{size}} of device storage',
                size: formatFileSize(size),
              })
            : t('settings.heatmapDescription', 'Uses device storage. Disable to save space.')}
        </Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={handleToggle}
        color={colors.primary}
        testID="heatmap-switch"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  textWrap: { flex: 1, marginLeft: spacing.sm },
  hint: { ...typography.caption, color: colors.textSecondary },
});
