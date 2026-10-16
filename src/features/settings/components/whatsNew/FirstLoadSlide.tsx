/**
 * Where the athlete's training comes from and where it is kept: intervals.icu, then this phone,
 * with the first load part of the way through.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, layout, spacing } from '@/theme';
import { tourPanelColour } from './tourPanel';

const ICON_BOX = 60;
const TRACK_HEIGHT = 6;
/** How far through the first load the picture shows, as a fraction. */
const LOADED = 0.6;

export function FirstLoadSlide() {
  const { isDark } = useTheme();
  const primaryColor = isDark ? darkColors.primary : colors.primary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bgColor = tourPanelColour(isDark);

  return (
    <View style={styles.container} testID="tour-first-load-picture">
      <View style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={'cloud-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={iconSize.xl}
            color={primaryColor}
          />
        </View>
        <MaterialCommunityIcons
          name={'arrow-right' as keyof typeof MaterialCommunityIcons.glyphMap}
          size={iconSize.lg}
          color={mutedColor}
        />
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={'cellphone' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={iconSize.xl}
            color={primaryColor}
          />
        </View>
      </View>
      <View style={[styles.track, { backgroundColor: bgColor }]}>
        <View style={[styles.fill, { width: `${LOADED * 100}%`, backgroundColor: primaryColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBox: {
    width: ICON_BOX,
    height: ICON_BOX,
    borderRadius: layout.borderRadiusMd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    width: ICON_BOX * 3,
    height: TRACK_HEIGHT,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: layout.borderRadiusXs,
  },
});
