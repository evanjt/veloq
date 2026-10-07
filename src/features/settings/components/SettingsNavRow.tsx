import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { colors, darkColors, typography, spacing } from '@/theme';
import { Row } from '@/shared/ui/Row';

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
    <Row testID={testID} onPress={onPress} accessibilityLabel={title}>
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
