/**
 * Cache scope notice component.
 * Shows how many activities have been processed and cache coverage.
 */

import React from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';

interface CacheScopeNoticeProps {
  /** Number of processed activities */
  processedCount: number;
  /** Total groups found */
  groupCount: number;
  /** Optional: callback when pressed */
  onPress?: () => void;
}

export function CacheScopeNotice({
  processedCount,
  groupCount,
  onPress,
}: CacheScopeNoticeProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const content = (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <MaterialCommunityIcons
        name="information-outline"
        size={16}
        color={isDark ? '#888' : colors.textSecondary}
      />
      <Text style={[styles.text, isDark && styles.textDark]}>
        Based on {processedCount} activities
        {groupCount > 0 && ` · ${groupCount} routes found`}
      </Text>
      {onPress && (
        <MaterialCommunityIcons
          name="chevron-right"
          size={16}
          color={isDark ? '#666' : '#999'}
        />
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: opacity.overlay.subtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  containerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  text: {
    flex: 1,
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textMuted,
  },
});
