/**
 * The heatmap switch, on the maps spoke beside the other things the map draws.
 *
 * The size beside the toggle is the cost of the thing being switched. The same
 * number appears in the storage table, which is the inventory, and both read
 * `readHeatmapTilesCacheSize` so there is one measurement rather than two.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, StyleSheet } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { formatFileSize } from '@/shared/format/format';
import {
  clearHeatmapTileSets,
  HEATMAP_TILES_DIR,
  LEGACY_HEATMAP_TILES_DIR,
  readHeatmapTilesCacheSize,
  useHeatmapPreference,
} from '@/features/maps';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { Row } from '@/shared/ui/Row';

export function HeatmapRow() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const enabled = useHeatmapPreference((s) => s.enabled);
  const setEnabled = useHeatmapPreference((s) => s.setEnabled);
  const [size, setSize] = useState(0);

  const refreshSize = useCallback(() => {
    readHeatmapTilesCacheSize().then(setSize);
  }, []);

  useEffect(() => {
    refreshSize();
  }, [refreshSize, enabled]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      const engine = getEngine();
      if (next) {
        engine?.enableHeatmapTiles();
        refreshSize();
        return;
      }
      // Off before the clear, so no pass starts while it runs, and the work
      // already going stops rather than holding a core for a heatmap nobody
      // wants. The clear itself waits out a pass that is still drawing.
      engine?.disableHeatmapTiles();
      engine?.cancelHeatmapWork();
      if (!(await clearHeatmapTileSets([HEATMAP_TILES_DIR, LEGACY_HEATMAP_TILES_DIR]))) {
        Alert.alert(t('alerts.error'), t('alerts.failedToClear'));
      }
      refreshSize();
    },
    [setEnabled, refreshSize, t]
  );

  return (
    <Row testID="heatmap-row">
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
    </Row>
  );
}

const styles = StyleSheet.create({
  textWrap: { flex: 1, marginLeft: spacing.sm },
  hint: { ...typography.caption, color: colors.textSecondary },
});
