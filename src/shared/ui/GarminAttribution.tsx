import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import { Icon } from './Icon';

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
        <Icon
          name="watch"
          size={iconSize.sm}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[styles.deviceText, isDark && styles.deviceTextDark]}>
          {t('attribution.recordedWith', { device: deviceName })}
        </Text>
      </View>
      {isGarmin ? (
        <Text style={[styles.attributionText, isDark && styles.attributionTextDark]}>
          {t('attribution.garminTrademark')}
        </Text>
      ) : null}
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
    ...typography.caption,
    color: colors.textSecondary,
  },
  deviceTextDark: {
    color: darkColors.textSecondary,
  },
  attributionText: {
    ...typography.micro,
    color: colors.textSecondary,
  },
  attributionTextDark: {
    color: darkColors.textSecondary,
  },
});
