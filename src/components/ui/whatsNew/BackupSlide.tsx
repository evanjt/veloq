import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';

const ICON_SIZE = 36;

export function BackupSlide() {
  const { isDark } = useTheme();
  const primaryColor = isDark ? darkColors.primary : colors.primary;
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;
  const bgColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={'database-export-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={ICON_SIZE}
            color={primaryColor}
          />
        </View>
        <MaterialCommunityIcons
          name={'arrow-right' as keyof typeof MaterialCommunityIcons.glyphMap}
          size={24}
          color={mutedColor}
        />
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={'share-variant-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={ICON_SIZE}
            color={primaryColor}
          />
        </View>
        <MaterialCommunityIcons
          name={'arrow-right' as keyof typeof MaterialCommunityIcons.glyphMap}
          size={24}
          color={mutedColor}
        />
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={'database-import-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={ICON_SIZE}
            color={primaryColor}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
