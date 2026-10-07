import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, spacing, typography } from '@/theme';
import { useTheme } from '@/shared/app';

/**
 * Helper to check if a device name indicates a Garmin device
 */
export function isGarminDevice(deviceName?: string | null): boolean {
  if (!deviceName) return false;
  const lower = deviceName.toLowerCase();
  return (
    lower.includes('garmin') ||
    lower.includes('forerunner') ||
    lower.includes('fenix') ||
    lower.includes('edge') ||
    lower.includes('venu') ||
    lower.includes('vivoactive') ||
    lower.includes('instinct') ||
    lower.includes('enduro') ||
    lower.includes('epix')
  );
}

interface DeviceAttributionProps {
  deviceName?: string | null;
}

export function DeviceAttribution({ deviceName }: DeviceAttributionProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  if (!deviceName) return null;

  const isGarmin = isGarminDevice(deviceName);

  return (
    <View style={styles.deviceContainer}>
      <View style={styles.deviceRow}>
        <MaterialCommunityIcons
          name="watch"
          size={14}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[styles.deviceText, isDark && styles.deviceTextDark]}>
          {t('attribution.recordedWith', { device: deviceName })}
        </Text>
      </View>
      {isGarmin && (
        <Text style={[styles.attributionText, isDark && styles.attributionTextDark]}>
          {t('attribution.garminTrademark')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  deviceContainer: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  deviceText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  deviceTextDark: {
    color: darkColors.textSecondary,
  },
  attributionText: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    opacity: 0.7,
  },
  attributionTextDark: {
    color: darkColors.textMuted,
  },
});
