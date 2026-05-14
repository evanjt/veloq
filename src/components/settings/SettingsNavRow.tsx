import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, typography, spacing, layout } from '@/theme';

interface SettingsNavRowProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle?: string;
  onPress: () => void;
  testID?: string;
}

export function SettingsNavRow({ icon, title, subtitle, onPress, testID }: SettingsNavRowProps) {
  const { isDark } = useTheme();

  return (
    <TouchableOpacity testID={testID} style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={isDark ? darkColors.textSecondary : colors.textSecondary}
      />
      <Text style={[styles.title, isDark && styles.titleDark]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, isDark && styles.subtitleDark]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={isDark ? darkColors.textMuted : colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  title: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },
  titleDark: {
    color: colors.textOnDark,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginRight: spacing.xs,
    maxWidth: '45%',
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
});
