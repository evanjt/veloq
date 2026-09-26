import React, { useCallback, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { router, type Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/app';
import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
import { rescanRefusalKey } from '@/features/routes';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING, pressable } from '@/shared/ui';
import {
  BackgroundJobsLink,
  CutoverStatus,
  ElevationBackfillStatus,
} from '@/features/settings/components';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';

export default function DetectionSettingsScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const routeMatchingEnabled = useRouteSettings((s) => s.settings.enabled);
  const setRouteMatchingEnabled = useRouteSettings((s) => s.setEnabled);
  const clearNotice = useRouteSettings((s) => s.clearNotice);
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const danger = isDark ? darkColors.error : colors.error;

  const {
    forceRescan,
    isScanning,
    cancelScan,
    result: rescanResult,
    failed: rescanFailed,
    stillRunning: rescanStillRunning,
    refusal: rescanRefusal,
    clearResult,
  } = useSectionRescan();

  // The confirm dialog's Reanalyse used to drop the engine's answer, so a
  // refused rescan closed the alert and showed nothing at all.
  const refusalKey = rescanRefusalKey(rescanRefusal);

  useEffect(() => {
    if (rescanResult === null) return undefined;
    const timer = setTimeout(clearResult, 5000);
    return () => clearTimeout(timer);
  }, [rescanResult, clearResult]);

  const handleRescan = useCallback(() => {
    Alert.alert(t('settings.reanalyzeSections'), t('settings.reanalyzeWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: () => forceRescan() },
    ]);
  }, [t, forceRescan]);

  return (
    <ScreenSafeAreaView
      hasNativeHeader
      testID="detection-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.toggleCard, { backgroundColor: surface, borderColor: border }]}>
          <View style={styles.toggleRow}>
            <MaterialCommunityIcons name="map-marker-path" size={22} color={textSecondary} />
            <Text style={[styles.toggleLabel, { color: textPrimary }]}>
              {t('settings.routeMatching')}
            </Text>
            <Switch
              value={routeMatchingEnabled}
              onValueChange={setRouteMatchingEnabled}
              color={colors.primary}
            />
          </View>
          {clearNotice !== null && (
            <Text
              testID="detection-clear-notice"
              style={[styles.toggleNote, { color: textSecondary }]}
            >
              {t(clearNotice)}
            </Text>
          )}
        </View>

        <View
          style={{ opacity: routeMatchingEnabled ? 1 : 0.4 }}
          pointerEvents={routeMatchingEnabled ? 'auto' : 'none'}
        >
          <Pressable
            style={pressable([
              styles.previewRow,
              { backgroundColor: surface, borderColor: border },
            ])}
            onPress={() => router.push('/detection-preview' as Href)}
            testID="detection-preview-row"
          >
            <MaterialCommunityIcons name="map-search-outline" size={20} color={textSecondary} />
            <Text style={[styles.previewRowText, { color: textPrimary }]}>
              {t('settings.previewSections')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={textSecondary} />
          </Pressable>

          <Pressable
            style={pressable([
              styles.previewRow,
              { backgroundColor: surface, borderColor: border },
            ])}
            onPress={() => router.push('/route-grouping-preview' as Href)}
            testID="route-grouping-preview-row"
          >
            <MaterialCommunityIcons name="source-branch" size={20} color={textSecondary} />
            <Text style={[styles.previewRowText, { color: textPrimary }]}>
              {t('settings.previewRouteGrouping')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={textSecondary} />
          </Pressable>

          <Pressable
            style={pressable([
              styles.rescanBtn,
              isScanning
                ? {
                    backgroundColor: surface,
                    borderColor: border,
                    borderWidth: StyleSheet.hairlineWidth,
                  }
                : { backgroundColor: brand.tealLight },
            ])}
            onPress={isScanning ? cancelScan : handleRescan}
            testID="detection-rescan-button"
          >
            {isScanning ? (
              <>
                <ActivityIndicator size="small" color={textSecondary} />
                <Text style={[styles.rescanText, { color: textSecondary }]}>
                  {t('common.cancel')}
                </Text>
              </>
            ) : (
              <>
                <MaterialCommunityIcons name="refresh" size={18} color={colors.textOnDark} />
                <Text style={[styles.rescanText, { color: colors.textOnDark }]}>
                  {t('settings.reanalyzeSections')}
                </Text>
              </>
            )}
          </Pressable>

          {rescanResult && (
            <Text style={[styles.rescanResult, { color: textSecondary }]}>
              {rescanResult.after} {t('settings.sectionsDetected', 'sections detected')}
            </Text>
          )}

          {refusalKey !== null && (
            <Text
              testID="detection-rescan-refused"
              style={[styles.rescanResult, { color: textSecondary }]}
            >
              {t(refusalKey)}
            </Text>
          )}

          {rescanStillRunning && (
            <Text
              testID="detection-rescan-still-running"
              style={[styles.rescanResult, { color: textSecondary }]}
            >
              {t('settings.stillRunning')}
            </Text>
          )}

          {rescanFailed && (
            <Text style={[styles.rescanResult, { color: danger }]}>
              {t(
                'settings.rescanFailed',
                'The rescan could not finish. Some activity tracks could not be read.'
              )}
            </Text>
          )}

          <ElevationBackfillStatus />

          <CutoverStatus />

          <BackgroundJobsLink />
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toggleCard: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  toggleLabel: {
    ...typography.body,
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
  },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: layout.borderRadius,
    marginTop: spacing.lg,
  },
  rescanText: {
    ...typography.body,
    fontWeight: '600',
  },
  toggleNote: {
    ...typography.bodySmall,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  rescanResult: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
  },
  previewRowText: {
    ...typography.body,
    flex: 1,
  },
});
