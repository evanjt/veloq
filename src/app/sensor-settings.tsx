import React, { useCallback, useEffect } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING, EmptyState } from '@/shared/ui';
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

const KIND_ICONS: Record<SensorKind, React.ComponentProps<typeof MaterialCommunityIcons>['name']> =
  {
    heartRate: 'heart-pulse',
    power: 'lightning-bolt',
    cadence: 'rotate-right',
  };

export default function SensorSettingsScreen() {
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
      testID="sensor-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          testID="sensor-settings-back"
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>
          {t('sensors.title', 'Sensors')}
        </Text>
      </View>

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
                  ? colors.success
                  : connection
                    ? colors.warning
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
                  <TouchableOpacity
                    testID={`sensor-forget-${sensor.id}`}
                    onPress={() => handleForget(sensor)}
                    style={styles.forgetButton}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('sensors.forget', 'Forget')}
                  >
                    <Text style={[styles.forgetText, { color: colors.error }]}>
                      {t('sensors.forget', 'Forget')}
                    </Text>
                  </TouchableOpacity>
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
              <TouchableOpacity
                testID="sensor-scan-button"
                style={[styles.scanButton, { backgroundColor: colors.primary }]}
                onPress={handleScan}
                activeOpacity={0.8}
              >
                {scanning ? (
                  <>
                    <ActivityIndicator size="small" color={colors.textOnDark} />
                    <Text style={styles.scanButtonText}>
                      {t('sensors.stopScan', 'Stop scanning')}
                    </Text>
                  </>
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name="bluetooth-connect"
                      size={18}
                      color={colors.textOnDark}
                    />
                    <Text style={styles.scanButtonText}>
                      {t('sensors.scan', 'Scan for sensors')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {discoverable.map((sensor) => (
                <TouchableOpacity
                  key={sensor.id}
                  testID={`sensor-discovered-${sensor.id}`}
                  style={[styles.card, { backgroundColor: surface, borderColor: border }]}
                  onPress={() => handlePair(sensor)}
                  activeOpacity={0.7}
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
                </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.sectionTitle,
    marginLeft: spacing.xs,
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
    marginTop: 2,
  },
  kindItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  kindLabel: {
    fontSize: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  forgetButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
  },
  forgetText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pairText: {
    fontSize: 14,
    fontWeight: '700',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  scanButtonText: {
    color: colors.textOnDark,
    fontSize: 15,
    fontWeight: '600',
  },
});
