import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, spacing } from '@/theme';
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
  text: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  textMedium: {
    fontSize: 12,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  garminText: {
    fontWeight: '600',
  },
  blockContainer: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  blockContainerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  deviceContainer: {
    alignItems: 'center',
    gap: 4,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  deviceTextDark: {
    color: darkColors.textSecondary,
  },
  attributionText: {
    fontSize: 9,
    color: colors.textSecondary,
    opacity: 0.7,
  },
  attributionTextDark: {
    color: darkColors.textMuted,
  },
});
