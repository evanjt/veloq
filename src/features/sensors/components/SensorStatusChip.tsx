import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { navigateTo } from '@/shared/app/navigation';
import { colors, spacing, layout, colorWithOpacity } from '@/theme';
import { useSensorStore } from '../store';
import type { SensorKind } from '../types';

const KIND_ICONS: Record<SensorKind, React.ComponentProps<typeof MaterialCommunityIcons>['name']> =
  {
    heartRate: 'heart-pulse',
    power: 'lightning-bolt',
    cadence: 'rotate-right',
  };

/**
 * Compact sensor state indicator for the recording screen. Hidden when the
 * user has no paired sensors and nothing is connected; tap opens sensor
 * settings.
 */
function SensorStatusChipInner() {
  const { t } = useTranslation();
  const connections = useSensorStore((s) => s.connections);
  const knownSensors = useSensorStore((s) => s.knownSensors);

  const entries = Object.values(connections);
  if (entries.length === 0 && knownSensors.length === 0) return null;

  const connectedKinds = new Set<SensorKind>();
  let reconnecting = false;
  for (const conn of entries) {
    if (conn.status === 'connected') {
      conn.kinds.forEach((k) => connectedKinds.add(k));
    } else {
      reconnecting = true;
    }
  }

  const tint = reconnecting
    ? colors.warning
    : connectedKinds.size > 0
      ? colors.success
      : colors.iconNeutral;

  return (
    <TouchableOpacity
      testID="sensor-status-chip"
      style={[styles.chip, { backgroundColor: colorWithOpacity(tint, 0.12) }]}
      onPress={() => navigateTo('/sensor-settings')}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('sensors.title', 'Sensors')}
    >
      <MaterialCommunityIcons name="bluetooth" size={13} color={tint} />
      {(['heartRate', 'power', 'cadence'] as SensorKind[])
        .filter((kind) => connectedKinds.has(kind))
        .map((kind) => (
          <MaterialCommunityIcons key={kind} name={KIND_ICONS[kind]} size={13} color={tint} />
        ))}
    </TouchableOpacity>
  );
}

export const SensorStatusChip = React.memo(SensorStatusChipInner);

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: layout.borderRadiusSm,
  },
});
