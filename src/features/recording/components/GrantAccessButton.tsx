/**
 * The single "Grant Access" affordance for the OAuth write-permission
 * upgrade. Used by the pre-start permission gate, the save error banner,
 * and the recordings-library upgrade banner so the action looks the same
 * everywhere it appears.
 */

import React from 'react';
import { TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { brand, colors, layout, spacing, typography } from '@/theme';

interface GrantAccessButtonProps {
  onPress: () => void;
  loading: boolean;
  small?: boolean;
  testID?: string;
}

export function GrantAccessButton({ onPress, loading, small, testID }: GrantAccessButtonProps) {
  const { t } = useTranslation();
  const label = t('recording.grantAccess', 'Grant Access');

  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.button, small && styles.buttonSmall]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.7}
      hitSlop={small ? { top: 8, bottom: 8, left: 4, right: 4 } : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.textOnDark} />
      ) : (
        <>
          <MaterialCommunityIcons
            name="shield-lock-outline"
            size={small ? 14 : 16}
            color={colors.textOnDark}
          />
          <Text style={[styles.label, small && styles.labelSmall]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: brand.teal,
    minHeight: layout.minTapTarget,
  },
  buttonSmall: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    minHeight: 32,
  },
  label: {
    ...typography.bodyBold,
    fontSize: typography.bodySmall.fontSize,
    color: colors.textOnDark,
  },
  labelSmall: {
    fontSize: typography.captionBold.fontSize,
  },
});
