import React, { useCallback, useEffect } from 'react';
import { View, StyleSheet, Pressable, Platform, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import {
  ScreenSafeAreaView,
  ScreenScrollView,
  useTabBarClearance,
  EmptyState,
  signalColor,
} from '@/shared/ui';
import { Button, ToggleButton } from '@/shared/ui/Button';
import { ListSectionHeader } from '@/shared/ui/ListSectionHeader';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { useTheme } from '@/shared/app';
import { useForeground } from '@/shared/app/useRetryTriggers';
import { openAppSettings } from '@/shared/app/permissions';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import {
  useSensorStore,
  startScan,
  stopScan,
  connectPairedSensor,
  releasePairingConnections,
  disconnectSensor,
  isBleAvailable,
  refreshBleAccess,
  turnOnBluetooth,
  displayedSensorSource,
  metricsSuppliedBy,
} from '@/features/sensors';
import type {
  DiscoveredSensor,
  KnownSensor,
  SensorAvailability,
  SensorKind,
} from '@/features/sensors';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const KIND_ICONS: Record<SensorKind, React.ComponentProps<typeof MaterialCommunityIcons>['name']> =
  {
    heartRate: 'heart-pulse',
    power: 'lightning-bolt',
    cadence: 'rotate-right',
  };

interface Notice {
  testID: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  description: string;
  action?: { label: string; onPress: () => void };
}

function openLocationSettings(): void {
  Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => {
    Linking.openSettings();
  });
}

/**
 * What stops a scan, and the one action that fixes it, or null when Scan can
 * run. Below Android 12 the grant a scan needs is location, so the copy says
 * so rather than naming a Bluetooth permission the system never shows.
 */
function availabilityNotice(availability: SensorAvailability, t: TFunction): Notice | null {
  const needsLocationGrant = Platform.OS === 'android' && Number(Platform.Version) < 31;
  switch (availability) {
    case 'unsupported':
      return {
        testID: 'sensor-availability-unsupported',
        icon: 'bluetooth-off',
        title: t('sensors.availability.unsupportedTitle'),
        description: t('sensors.availability.unsupportedHint'),
      };
    case 'poweredOff':
      return {
        testID: 'sensor-availability-poweredOff',
        icon: 'bluetooth-off',
        title: t('sensors.availability.poweredOffTitle'),
        // iOS lets an app neither turn the radio on nor open its page.
        ...(Platform.OS === 'android'
          ? {
              description: t('sensors.availability.poweredOffHint'),
              action: {
                label: t('sensors.availability.turnOn'),
                onPress: () => void turnOnBluetooth(),
              },
            }
          : { description: t('sensors.availability.poweredOffHintIos') }),
      };
    case 'unauthorised':
      return {
        testID: 'sensor-availability-unauthorised',
        icon: 'shield-lock-outline',
        title: needsLocationGrant
          ? t('sensors.availability.locationPermissionTitle')
          : t('sensors.availability.permissionTitle'),
        description: needsLocationGrant
          ? t('sensors.availability.locationPermissionHint')
          : t('sensors.availability.permissionHint'),
        action: { label: t('sensors.availability.allow'), onPress: () => void startScan() },
      };
    case 'blocked':
      return {
        testID: 'sensor-availability-blocked',
        icon: 'shield-lock-outline',
        title: needsLocationGrant
          ? t('sensors.availability.locationPermissionTitle')
          : t('sensors.availability.permissionTitle'),
        description: needsLocationGrant
          ? t('sensors.availability.locationBlockedHint')
          : t('sensors.availability.blockedHint'),
        action: { label: t('common.openSettings'), onPress: openAppSettings },
      };
    case 'needsLocation':
      return {
        testID: 'sensor-availability-needsLocation',
        icon: 'map-marker-off',
        title: t('sensors.availability.locationOffTitle'),
        description: t('sensors.availability.locationOffHint'),
        action: {
          label: t('sensors.availability.openLocationSettings'),
          onPress: openLocationSettings,
        },
      };
    default:
      return null;
  }
}

function SensorSettingsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const tabBarClearance = useTabBarClearance();

  const scanning = useSensorStore((s) => s.scanning);
  const discovered = useSensorStore((s) => s.discovered);
  const knownSensors = useSensorStore((s) => s.knownSensors);
  const connections = useSensorStore((s) => s.connections);
  const isLoaded = useSensorStore((s) => s.isLoaded);
  const availability = useSensorStore((s) => s.availability);
  const scanFinished = useSensorStore((s) => s.scanFinished);
  const activeSources = useSensorStore((s) => s.activeSources);
  const suppliedKinds = useSensorStore((s) => s.suppliedKinds);

  useEffect(() => {
    if (!isLoaded) {
      useSensorStore.getState().initialise();
    }
  }, [isLoaded]);

  useEffect(() => {
    return () => {
      stopScan();
      void releasePairingConnections();
    };
  }, []);

  // Open settings leaves the app, and a grant or location services turned on
  // there is only seen by reading again on the way back.
  useForeground(() => void refreshBleAccess());

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const accentText = isDark ? darkColors.linkTeal : colors.linkTeal;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const handleScan = useCallback(() => {
    if (scanning) {
      stopScan();
      return;
    }
    void startScan();
  }, [scanning]);

  const handlePair = useCallback((sensor: DiscoveredSensor) => {
    stopScan();
    const known = { id: sensor.id, name: sensor.name, kinds: sensor.kinds };
    useSensorStore.getState().addKnownSensor(known);
    void connectPairedSensor(known);
  }, []);

  const handleForget = useCallback((sensor: KnownSensor) => {
    useSensorStore.getState().removeKnownSensor(sensor.id);
    disconnectSensor(sensor.id);
  }, []);

  const handleChooseSource = useCallback((sensor: KnownSensor, kind: SensorKind) => {
    if (sensor.preferredFor?.includes(kind)) return;
    useSensorStore.getState().setPreferredSource(sensor.id, kind);
  }, []);

  const pairedIds = new Set(knownSensors.map((s) => s.id));
  const pairedMetrics = new Map(
    knownSensors.map((sensor) => [sensor.id, metricsSuppliedBy(sensor, suppliedKinds[sensor.id])])
  );
  const sourceOf = (kind: SensorKind) =>
    displayedSensorSource(kind, knownSensors, activeSources[kind]);
  const sharedMetric = (['heartRate', 'power', 'cadence'] as const).some(
    (kind) => [...pairedMetrics.values()].filter((kinds) => kinds.includes(kind)).length > 1
  );
  const discoverable = discovered.filter((d) => !pairedIds.has(d.id));
  const bleAvailable = isBleAvailable();
  const blocking = availabilityNotice(availability, t);
  const foundNothing = !blocking && !scanning && scanFinished && discoverable.length === 0;
  const notice: Notice | null =
    blocking ??
    (foundNothing
      ? {
          testID: 'sensor-scan-empty',
          icon: 'magnify-close',
          title: t('sensors.noneFound'),
          description: t('sensors.noneFoundHint'),
          action: { label: t('sensors.scanAgain'), onPress: () => void startScan() },
        }
      : null);
  useAnnounceOnAppear(notice ? `${notice.title}. ${notice.description}` : null);

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

  // Each metric is recorded from one sensor. A filled chip is the sensor it is
  // recorded from, and tapping an unfilled one makes that sensor the source.
  const renderSources = (sensor: KnownSensor) => (
    <View style={styles.kindRow}>
      {(pairedMetrics.get(sensor.id) ?? []).map((kind) => {
        const isSource = sourceOf(kind) === sensor.id;
        return (
          <ToggleButton
            key={kind}
            testID={`sensor-source-${sensor.id}-${kind}`}
            label={t(`sensors.kinds.${kind}`)}
            accessibilityLabel={t('sensors.recordFrom', {
              kind: t(`sensors.kinds.${kind}`),
              name: sensor.name,
            })}
            selected={isSource}
            icon={
              <MaterialCommunityIcons
                name={KIND_ICONS[kind]}
                size={14}
                color={isSource ? colors.textOnPrimary : textSecondary}
              />
            }
            onPress={() => handleChooseSource(sensor, kind)}
          />
        );
      })}
    </View>
  );

  return (
    <ScreenSafeAreaView
      hasNativeHeader
      testID="sensor-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
      >
        {/* Paired sensors */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>
            {t('sensors.paired', 'Paired sensors')}
          </ListSectionHeader>
          {sharedMetric && (
            <Text style={[styles.sourceHint, { color: textSecondary }]}>
              {t('sensors.chooseSourceHint')}
            </Text>
          )}
          {knownSensors.length === 0 ? (
            <EmptyState
              variant="inline"
              title={t('sensors.nonePaired', 'No sensors paired yet. Scan below to add one.')}
            />
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
                    {renderSources(sensor)}
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
          <ListSectionHeader inset={false}>
            {t('sensors.addSensor', 'Add a sensor')}
          </ListSectionHeader>

          {!bleAvailable ? (
            <EmptyState
              icon="bluetooth-off"
              title={t('sensors.bleUnavailable', 'Bluetooth is not available')}
              description={t(
                'sensors.bleUnavailableHint',
                'This build does not include Bluetooth support.'
              )}
              variant="compact"
            />
          ) : notice ? (
            <View testID={notice.testID} accessibilityLiveRegion="polite">
              <EmptyState
                icon={notice.icon}
                title={notice.title}
                description={notice.description}
                actionLabel={notice.action?.label}
                onAction={notice.action?.onPress}
                actionTestID="sensor-availability-action"
                variant="compact"
              />
            </View>
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
              <Text style={[styles.purpose, { color: textSecondary }]}>{t('sensors.purpose')}</Text>

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
                  <Text style={[styles.pairText, { color: accentText }]}>
                    {t('sensors.pair', 'Pair')}
                  </Text>
                </Pressable>
              ))}

              {scanning && discoverable.length === 0 && (
                <Text style={[styles.searchingLine, { color: textSecondary }]}>
                  {t('sensors.searching', 'Searching for nearby sensors…')}
                </Text>
              )}
            </>
          )}
        </View>
      </ScreenScrollView>
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
  searchingLine: {
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
  sourceHint: {
    ...typography.bodySmall,
    paddingBottom: spacing.sm,
  },
  kindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    marginBottom: spacing.xs,
  },
  purpose: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
});

export default withScreenBoundary(SensorSettingsScreenContent, 'SensorSettings');
