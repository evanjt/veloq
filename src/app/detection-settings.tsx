import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { router, type Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/app';
import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { DetectionIllustration, ElevationBackfillStatus } from '@/features/settings/components';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { getEngine, UNIFIED_CONFIG } from '@/shared/native/engine';

type DetectionParams = {
  proximityThreshold: number;
  minSectionLength: number;
  minActivities: number;
  divergenceThreshold: number;
};

/** The configuration the detector is validated at, used until the engine
 *  reports what it has persisted. */
function defaultParams(): DetectionParams {
  return {
    proximityThreshold: UNIFIED_CONFIG.proximityThreshold,
    minSectionLength: UNIFIED_CONFIG.minSectionLength,
    minActivities: UNIFIED_CONFIG.minActivities,
    divergenceThreshold: UNIFIED_CONFIG.divergenceThreshold,
  };
}

/** What the engine actually has persisted, or the compiled defaults when it
 *  is not ready yet. The illustration has to draw these or it shows numbers
 *  the detector is not using. */
function loadParams(): DetectionParams {
  const config = getEngine()?.getSectionConfig();
  if (!config) return defaultParams();
  return {
    proximityThreshold: config.proximityThreshold,
    minSectionLength: config.minSectionLength,
    minActivities: config.minActivities,
    divergenceThreshold: config.divergenceThreshold,
  };
}

export default function DetectionSettingsScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const routeMatchingEnabled = useRouteSettings((s) => s.settings.enabled);
  const setRouteMatchingEnabled = useRouteSettings((s) => s.setEnabled);
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const danger = isDark ? darkColors.error : colors.error;

  const [params, setParams] = useState<DetectionParams>(loadParams);

  // The engine can still be initialising on the first render, and then the
  // lazy seed above fell back to the defaults.
  useEffect(() => {
    if (!getEngine()?.getSectionConfig()) return;
    setParams(loadParams());
  }, []);

  const {
    forceRescan,
    isScanning,
    result: rescanResult,
    failed: rescanFailed,
    clearResult,
  } = useSectionRescan();

  useEffect(() => {
    if (rescanResult === null) return;
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
      testID="detection-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          testID="detection-settings-back"
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>
          {t('settings.sectionDetection')}
        </Text>
      </View>

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
        </View>

        <View
          style={{ opacity: routeMatchingEnabled ? 1 : 0.4 }}
          pointerEvents={routeMatchingEnabled ? 'auto' : 'none'}
        >
          <DetectionIllustration
            proximity={params.proximityThreshold}
            minSectionLength={params.minSectionLength}
            minActivities={params.minActivities}
            divergenceThreshold={params.divergenceThreshold}
          />

          <Pressable
            style={[
              styles.rescanBtn,
              isScanning
                ? {
                    backgroundColor: surface,
                    borderColor: border,
                    borderWidth: StyleSheet.hairlineWidth,
                  }
                : { backgroundColor: brand.tealLight },
            ]}
            onPress={handleRescan}
            disabled={isScanning}
            testID="detection-rescan-button"
          >
            {isScanning ? (
              <ActivityIndicator size="small" color={textSecondary} />
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

          {rescanFailed && (
            <Text style={[styles.rescanResult, { color: danger }]}>
              {t(
                'settings.rescanFailed',
                'The rescan could not finish. Some activity tracks could not be read.'
              )}
            </Text>
          )}

          <Pressable
            style={[styles.previewRow, { backgroundColor: surface, borderColor: border }]}
            onPress={() => router.push('/detection-preview' as Href)}
            testID="detection-preview-row"
          >
            <MaterialCommunityIcons name="map-search-outline" size={20} color={textSecondary} />
            <Text style={[styles.previewRowText, { color: textPrimary }]}>
              {t('settings.previewSections')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={textSecondary} />
          </Pressable>

          <ElevationBackfillStatus />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  headerTitle: {
    ...typography.sectionTitle,
    fontWeight: '600',
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
