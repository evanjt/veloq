import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, SegmentedButtons } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useMapPreferences } from '@/providers';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';
import { MapStylePreviewPicker } from '@/components/settings/MapStylePreviewPicker';

export function MapPreferencesSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { preferences, setDefaultStyle, setTerrain3DMode } = useMapPreferences();

  // Default to satellite + smart when the slide first appears in What's New
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      setDefaultStyle('satellite');
      setTerrain3DMode(null, 'smart');
    }
  }, [setDefaultStyle, setTerrain3DMode]);

  const terrain3DButtons = [
    { value: 'off', label: t('settings.terrain3DOff' as never) as string },
    { value: 'smart', label: t('settings.terrain3DSmart' as never) as string },
    { value: 'always', label: t('settings.terrain3DAlways' as never) as string },
  ];

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
        <SegmentedButtons
          value={preferences.terrain3DMode || 'off'}
          onValueChange={(value) => setTerrain3DMode(null, value as 'off' | 'smart' | 'always')}
          buttons={terrain3DButtons}
          density="small"
          style={styles.segmented}
        />
      </View>
      <Text style={[styles.hint, { color: isDark ? darkColors.textMuted : colors.textMuted }]}>
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
    fontSize: 14,
    fontWeight: '500',
  },
  segmented: {
    maxWidth: 280,
  },
  hint: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
});
