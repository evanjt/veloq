import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';

interface GarminAttributionProps {
  /** The device name to check for Garmin branding */
  deviceName?: string | null;
  /** Optional: force show attribution regardless of device name */
  forceShow?: boolean;
  /** Display variant */
  variant?: 'inline' | 'block';
  /** Size variant */
  size?: 'small' | 'medium';
}

/**
 * Helper to check if a device name indicates a Garmin device
 */
export function isGarminDevice(deviceName?: string | null): boolean {
  if (!deviceName) return false;
  const lower = deviceName.toLowerCase();
  return lower.includes('garmin') ||
         lower.includes('forerunner') ||
         lower.includes('fenix') ||
         lower.includes('edge') ||
         lower.includes('venu') ||
         lower.includes('vivoactive') ||
         lower.includes('instinct') ||
         lower.includes('enduro') ||
         lower.includes('epix');
}

/**
 * Garmin Attribution component
 *
 * Per Garmin's brand guidelines, applications displaying information
 * derived from Garmin-sourced data must provide attribution to Garmin.
 *
 * This component displays "Garmin" text when the data source is a Garmin device.
 */
export function GarminAttribution({
  deviceName,
  forceShow = false,
  variant = 'inline',
  size = 'small',
}: GarminAttributionProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const showAttribution = forceShow || isGarminDevice(deviceName);

  if (!showAttribution) {
    return null;
  }

  const textStyle = [
    styles.text,
    size === 'medium' && styles.textMedium,
    isDark && styles.textDark,
  ];

  if (variant === 'block') {
    return (
      <View style={[styles.blockContainer, isDark && styles.blockContainerDark]}>
        <Text style={textStyle}>
          <Text style={styles.garminText}>Garmin</Text>
        </Text>
      </View>
    );
  }

  return (
    <Text style={textStyle}>
      <Text style={styles.garminText}>Garmin</Text>
    </Text>
  );
}

/**
 * Full device attribution with Garmin branding when applicable
 */
interface DeviceAttributionProps {
  deviceName?: string | null;
}

export function DeviceAttribution({ deviceName }: DeviceAttributionProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (!deviceName) return null;

  const isGarmin = isGarminDevice(deviceName);

  return (
    <View style={styles.deviceContainer}>
      <View style={styles.deviceRow}>
        <MaterialCommunityIcons
          name="watch"
          size={14}
          color={isDark ? '#666' : colors.textSecondary}
        />
        <Text style={[styles.deviceText, isDark && styles.deviceTextDark]}>
          Recorded with {deviceName}
        </Text>
      </View>
      {isGarmin && (
        <Text style={[styles.attributionText, isDark && styles.attributionTextDark]}>
          Garmin and the Garmin logo are trademarks of Garmin Ltd.
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
    color: '#888',
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
    color: '#666',
  },
  attributionText: {
    fontSize: 9,
    color: colors.textSecondary,
    opacity: 0.7,
  },
  attributionTextDark: {
    color: '#555',
  },
});
