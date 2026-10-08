import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useMapPreferences } from '../../stores/MapPreferencesContext';
import { useMetricSystem, useTheme } from '@/shared/app';
import { SMART_3D_MIN_RELIEF_M } from '@/features/maps';
import { formatElevation } from '@/shared/format/format';
import { colors, darkColors, spacing, typography } from '@/theme';
import { MapStylePreviewPicker } from '@/features/settings/components/MapStylePreviewPicker';
import { Terrain3DPicker } from '@/features/settings/components/Terrain3DPicker';

export function MapPreferencesSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { preferences, setDefaultStyle, setTerrain3DMode } = useMapPreferences();

  return (
    <View style={styles.container}>
      <MapStylePreviewPicker value={preferences.defaultStyle} onValueChange={setDefaultStyle} />
      <View style={styles.terrainRow}>
        <Text
          style={[
            styles.terrainLabel,
            { color: isDark ? darkColors.textSecondary : colors.textSecondary },
          ]}
        >
          {t('settings.terrain3D' as never)}
        </Text>
        <View style={styles.terrainPicker}>
          <Terrain3DPicker
            value={preferences.terrain3DMode || 'off'}
            onValueChange={(mode) => setTerrain3DMode(null, mode)}
          />
        </View>
      </View>
      <Text
        style={[styles.hint, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
      >
        {t('settings.terrain3DSmartHint', {
          height: formatElevation(SMART_3D_MIN_RELIEF_M, isMetric),
        })}
      </Text>
      <Text
        style={[styles.hint, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
      >
        {t('whatsNew.v022.mapStylesHint' as never)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.md,
  },
  terrainRow: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  terrainLabel: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
  },
  terrainPicker: {
    width: '100%',
    maxWidth: 280,
  },
  hint: {
    fontSize: typography.label.fontSize,
    lineHeight: 15,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
});
