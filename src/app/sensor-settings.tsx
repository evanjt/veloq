import React, { useCallback, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING, EmptyState, signalColor } from '@/shared/ui';
import { Button } from '@/shared/ui/Button';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import {
  useSensorStore,
  startScan,
  stopScan,
  connectKnownSensors,
  disconnectSensor,
  requestBlePermissions,
  isBleAvailable,
} from '@/features/sensors';
import type { DiscoveredSensor, KnownSensor, SensorKind } from '@/features/sensors';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const KIND_ICONS: Record<SensorKind, React.ComponentProps<typeof MaterialCommunityIcons>['name']> =
  {
    heartRate: 'heart-pulse',
    power: 'lightning-bolt',
    cadence: 'rotate-right',
  };

function SensorSettingsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const scanning = useSensorStore((s) => s.scanning);
  const discovered = useSensorStore((s) => s.discovered);
  const knownSensors = useSensorStore((s) => s.knownSensors);
  const connections = useSensorStore((s) => s.connections);
  const isLoaded = useSensorStore((s) => s.isLoaded);

  useEffect(() => {
    if (!isLoaded) {
      useSensorStore.getState().initialize();
    }
  }, [isLoaded]);

  useEffect(() => {
    return () => stopScan();
  }, []);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const handleScan = useCallback(async () => {
    if (scanning) {
      stopScan();
      return;
    }
    const granted = await requestBlePermissions();
    if (granted) {
      await startScan();
    }
  }, [scanning]);

  const handlePair = useCallback((sensor: DiscoveredSensor) => {
    stopScan();
    useSensorStore.getState().addKnownSensor({
      id: sensor.id,
      name: sensor.name,
      kinds: sensor.kinds,
    });
    connectKnownSensors();
  }, []);

  const handleForget = useCallback((sensor: KnownSensor) => {
    useSensorStore.getState().removeKnownSensor(sensor.id);
    disconnectSensor(sensor.id);
  }, []);

  const pairedIds = new Set(knownSensors.map((s) => s.id));
  const discoverable = discovered.filter((d) => !pairedIds.has(d.id));
  const bleAvailable = isBleAvailable();

  const renderKinds = (kinds: SensorKind[], color: string) => (
    <View style={styles.kindRow}>
      {kinds.map((kind) => (
        <View key={kind} style={styles.kindItem}>
          <MaterialCommunityIcons name={KIND_ICONS[kind]} size={14} color={color} />
          <Text style={[styles.kindLabel, { color }]}>{t(`sensors.kinds.${kind}`)}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScreenSafeAreaView
      hasNativeHeader
      testID="sensor-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING },
        ]}
      >
        {/* Paired sensors */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('sensors.paired', 'Paired sensors')}
          </Text>
          {knownSensors.length === 0 ? (
            <Text style={[styles.emptyHint, { color: textSecondary }]}>
              {t('sensors.nonePaired', 'No sensors paired yet. Scan below to add one.')}
            </Text>
          ) : (
            knownSensors.map((sensor) => {
              const connection = connections[sensor.id];
              const statusColor =
                connection?.status === 'connected'
                  ? signalColor('ok', isDark)
                  : connection
                    ? signalColor('warn', isDark)
                    : textSecondary;
              return (
                <View
                  key={sensor.id}
                  testID={`sensor-paired-${sensor.id}`}
                  style={[styles.card, { backgroundColor: surface, borderColor: border }]}
                >
                  <View style={styles.cardBody}>
                    <Text style={[styles.cardTitle, { color: textPrimary }]} numberOfLines={1}>
                      {sensor.name}
                    </Text>
                    {renderKinds(sensor.kinds, textSecondary)}
                    <Text style={[styles.statusText, { color: statusColor }]}>
                      {connection
                        ? t(`sensors.status.${connection.status}`)
                        : t('sensors.status.disconnected', 'Not connected')}
                      {connection?.batteryPercent != null ? ` · ${connection.batteryPercent}%` : ''}
                    </Text>
                  </View>
                  <Button
                    testID={`sensor-forget-${sensor.id}`}
                    onPress={() => handleForget(sensor)}
                    label={t('sensors.forget', 'Forget')}
                    variant="destructive"
                    size="sm"
                  />
                </View>
              );
            })
          )}
        </View>

        {/* Scan */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('sensors.addSensor', 'Add a sensor')}
          </Text>

          {!bleAvailable ? (
            <EmptyState
              icon="bluetooth-off"
              title={t('sensors.bleUnavailable', 'Bluetooth is not available')}
              description={t(
                'sensors.bleUnavailableHint',
                'This build does not include Bluetooth support.'
              )}
              compact
            />
          ) : (
            <>
              <Button
                testID="sensor-scan-button"
                style={styles.scanButton}
                onPress={handleScan}
                label={
                  scanning
                    ? t('sensors.stopScan', 'Stop scanning')
                    : t('sensors.scan', 'Scan for sensors')
                }
                icon={
                  <MaterialCommunityIcons
                    name="bluetooth-connect"
                    size={18}
                    color={colors.textOnPrimary}
                  />
                }
              />

              {discoverable.map((sensor) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('sensors.pair')}: ${sensor.name}`}
                  key={sensor.id}
                  testID={`sensor-discovered-${sensor.id}`}
                  style={pressable([
                    styles.card,
                    { backgroundColor: surface, borderColor: border },
                  ])}
                  android_ripple={pressRipple}
                  onPress={() => handlePair(sensor)}
                >
                  <View style={styles.cardBody}>
                    <Text style={[styles.cardTitle, { color: textPrimary }]} numberOfLines={1}>
                      {sensor.name}
                    </Text>
                    {renderKinds(sensor.kinds, textSecondary)}
                  </View>
                  <Text style={[styles.pairText, { color: brand.teal }]}>
                    {t('sensors.pair', 'Pair')}
                  </Text>
                </Pressable>
              ))}

              {scanning && discoverable.length === 0 && (
                <Text style={[styles.emptyHint, { color: textSecondary }]}>
                  {t('sensors.searching', 'Searching for nearby sensors…')}
                </Text>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.sm,
  },
  section: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  emptyHint: {
    ...typography.bodySmall,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  cardBody: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardTitle: {
    ...typography.bodyBold,
  },
  kindRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  kindItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  kindLabel: {
    fontSize: typography.caption.fontSize,
  },
  statusText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    marginTop: spacing.xxs,
  },
  pairText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
  },
  scanButton: {
    marginBottom: spacing.sm,
  },
});

export default withScreenBoundary(SensorSettingsScreenContent, 'SensorSettings');
