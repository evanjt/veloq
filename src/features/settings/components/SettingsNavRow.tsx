import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { Row } from '@/shared/ui/Row';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';

interface SettingsNavRowProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle?: string;
  onPress: () => void;
  /** Greys the row and stops its press. */
  disabled?: boolean;
  testID?: string;
}

export function SettingsNavRow({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
  testID,
}: SettingsNavRowProps) {
  const { isDark } = useTheme();

  return (
    <Row
      testID={testID}
      behaviour="navigate"
      onPress={onPress}
      accessibilityLabel={composeAccessibilityLabel(title, subtitle)}
      disabled={disabled}
    >
      <MaterialCommunityIcons
        name={icon}
        size={iconSize.lg}
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
    </Row>
  );
}

const styles = StyleSheet.create({
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
