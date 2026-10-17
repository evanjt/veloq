import React from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { Row } from '@/shared/ui/Row';
import { useLargeText } from '@/shared/ui/useLargeText';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';

interface SettingsNavRowProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle?: string | undefined;
  onPress: () => void;
  /** Greys the row and stops its press. */
  disabled?: boolean;
  /** `warning` draws the icon in the warning tone, for a row that reports a fixable failure. */
  tone?: 'warning';
  testID?: string;
}

export function SettingsNavRow({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
  tone,
  testID,
}: SettingsNavRowProps) {
  const { isDark } = useTheme();
  // Past the dense cap a title and value side by side both cut off, so the
  // title wraps and the value moves under it.
  const stacked = useLargeText();
  const titleStyle = [styles.title, isDark && styles.titleDark];
  const subtitleStyle = [styles.subtitle, isDark && styles.subtitleDark];

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
        color={
          tone === 'warning'
            ? (isDark ? darkColors : colors).warningAmber
            : isDark
              ? darkColors.textSecondary
              : colors.textSecondary
        }
      />
      {stacked ? (
        <View style={styles.stack}>
          <Text style={titleStyle}>{title}</Text>
          {subtitle ? (
            <Text style={subtitleStyle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          <Text style={[titleStyle, styles.titleBeside]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[subtitleStyle, styles.subtitleBeside]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </>
      )}
    </Row>
  );
}

const styles = StyleSheet.create({
  stack: {
    flex: 1,
  },
  title: {
    ...typography.body,
    color: colors.textPrimary,
  },
  titleBeside: {
    flex: 1,
  },
  titleDark: {
    color: colors.textOnDark,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  subtitleBeside: {
    marginRight: spacing.xs,
    maxWidth: '45%',
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
});
