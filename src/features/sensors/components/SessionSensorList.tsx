import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Button, NameText, Row, SignalStatus, type SignalLevel } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { formatCadence, formatHeartRate, formatPower } from '@/shared/format/format';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { useRecordingStore } from '@/features/recording';

import { useSensorStore } from '../store';
import {
  distinctLabels,
  isUnnamed,
  sessionSensorRows,
  type SessionSensorRow,
  type SessionSensorState,
  type SignalLevel as SignalBars,
} from '../lib/sensorRows';
import {
  connectSensorForSession,
  disconnectSensor,
  dropSensorForSession,
} from '../lib/sensorManager';
import type { SensorKind } from '../types';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const STATE_SIGNAL: Record<SessionSensorState, { level: SignalLevel; icon: IconName }> = {
  connected: { level: 'ok', icon: 'bluetooth-connect' },
  connecting: { level: 'idle', icon: 'bluetooth-settings' },
  reconnecting: { level: 'warn', icon: 'bluetooth-settings' },
  noData: { level: 'warn', icon: 'bluetooth-audio' },
  off: { level: 'idle', icon: 'bluetooth-off' },
};

const SIGNAL_ICONS: Record<SignalBars, IconName> = {
  1: 'signal-cellular-1',
  2: 'signal-cellular-2',
  3: 'signal-cellular-3',
};

const FORMAT_SAMPLE: Record<SensorKind, (value: number) => string> = {
  heartRate: formatHeartRate,
  power: formatPower,
  cadence: formatCadence,
};

/**
 * The paired sensors before a ride: one row each with its kind, link state,
 * live value, battery and signal, and a way to disconnect it for this session
 * or forget the pairing. Draws nothing when no sensor is paired.
 */
export function SessionSensorList() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const knownSensors = useSensorStore((s) => s.knownSensors);
  const connections = useSensorStore((s) => s.connections);
  const activeSources = useSensorStore((s) => s.activeSources);
  const suppliedKinds = useSensorStore((s) => s.suppliedKinds);
  const latestSensor = useRecordingStore((s) => s.latestSensor);

  const rows = useMemo(
    () =>
      sessionSensorRows({ knownSensors, connections, activeSources, suppliedKinds, latestSensor }),
    [knownSensors, connections, activeSources, suppliedKinds, latestSensor]
  );
  if (rows.length === 0) return null;

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const readableName = (row: SessionSensorRow) =>
    isUnnamed(row.sensor)
      ? t('sensors.unnamed', { kind: t(`sensors.kinds.${row.sensor.kinds[0] ?? 'heartRate'}`) })
      : row.sensor.name;
  const labels = distinctLabels(rows.map((row) => ({ id: row.id, label: readableName(row) })));

  return (
    <View testID="entry-sensors" style={styles.list}>
      {rows.map((row) => {
        const name = labels.get(row.id) ?? row.sensor.name;
        const { level, icon } = STATE_SIGNAL[row.state];
        const status = [
          row.sensor.kinds.map((kind) => t(`sensors.kinds.${kind}`)).join(', '),
          row.state === 'off' ? t('sensors.status.disconnected') : t(`sensors.status.${row.state}`),
          ...row.live.map(({ kind, value }) => FORMAT_SAMPLE[kind](value)),
          row.batteryPercent != null ? `${row.batteryPercent}%` : null,
        ]
          .filter((part): part is string => !!part)
          .join(' · ');
        return (
          <Row
            key={row.id}
            testID={`entry-sensor-${row.id}`}
            inset="none"
            accessory={
              <View style={styles.actions}>
                {row.state === 'off' ? (
                  <Button
                    testID={`entry-sensor-connect-${row.id}`}
                    label={t('sensors.connect')}
                    variant="ghost"
                    size="sm"
                    onPress={() => void connectSensorForSession(row.id)}
                  />
                ) : (
                  <Button
                    testID={`entry-sensor-disconnect-${row.id}`}
                    label={t('sensors.disconnect')}
                    variant="ghost"
                    size="sm"
                    onPress={() => void dropSensorForSession(row.id)}
                  />
                )}
                <Button
                  testID={`entry-sensor-forget-${row.id}`}
                  label={t('sensors.forget')}
                  variant="destructive"
                  size="sm"
                  onPress={() => {
                    useSensorStore.getState().removeKnownSensor(row.id);
                    void disconnectSensor(row.id);
                  }}
                />
              </View>
            }
          >
            <View style={styles.body}>
              <View style={styles.titleLine}>
                <NameText style={[styles.name, { color: textPrimary }]}>{name}</NameText>
                {row.signal != null ? (
                  <Icon
                    testID={`entry-sensor-signal-${row.id}`}
                    name={SIGNAL_ICONS[row.signal]}
                    size={iconSize.sm}
                    color={textSecondary}
                    accessibilityLabel={t('sensors.signal', { dbm: Math.round(row.rssi ?? 0) })}
                  />
                ) : null}
              </View>
              <SignalStatus
                testID={`entry-sensor-status-${row.id}`}
                level={level}
                icon={icon}
                label={status}
              />
            </View>
          </Row>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xxs,
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    ...typography.bodyBold,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
