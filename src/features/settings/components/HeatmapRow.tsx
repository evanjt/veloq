/**
 * The heatmap switch, on the maps spoke beside the other things the map draws.
 *
 * The size beside the toggle is the cost of the thing being switched. The same
 * number appears in the storage table, which is the inventory, and both read
 * `readHeatmapTilesCacheSize` so there is one measurement rather than two.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getEngine } from '@/shared/native/engine';
import { formatFileSize } from '@/shared/format/format';
import {
  clearHeatmapTileSets,
  HEATMAP_TILES_DIR,
  LEGACY_HEATMAP_TILES_DIR,
  readHeatmapTilesCacheSize,
  useHeatmapPreference,
} from '@/features/maps';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { inform } from '@/shared/ui/dialog';

export function HeatmapRow() {
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
        inform({ title: t('alerts.clearFailedTitle'), message: t('alerts.failedToClear') });
      }
      refreshSize();
    },
    [setEnabled, refreshSize, t]
  );

  return (
    <View testID="heatmap-row">
      <SwitchRow
        icon="map-legend"
        title={t('settings.heatmapGeneration', 'Heatmap')}
        description={
          enabled && size > 0
            ? t('settings.heatmapStorageUsed', {
                defaultValue: 'Using {{size}} of device storage',
                size: formatFileSize(size),
              })
            : t('settings.heatmapDescription', 'Uses device storage. Disable to save space.')
        }
        value={enabled}
        onValueChange={handleToggle}
        testID="heatmap-switch"
      />
    </View>
  );
}
