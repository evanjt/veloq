/**
 * Detection preview: test new section settings on one riding area before
 * applying them everywhere. The screen opens on the live catalogue for the
 * chosen area, so the map shows what the detector holds today. The five
 * sliders are pure local state; nothing is cut until the Preview button runs a
 * sandboxed detect against that catalogue, and only Keep writes the config and
 * re-analyses the library.
 *
 * Nothing here scrolls vertically. Tuning a slider you cannot see the map for
 * defeats the screen, so the map and the controls share one fixed column and
 * the panel is sized to fit rather than to scroll. That is what the intro
 * paragraph, the picker label and the standalone Preview button cost, and why
 * they are gone: once a run has produced a result, Preview joins Discard and
 * Keep in the one decision row.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/app';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { colors, darkColors, brand, spacing, layout, typography } from '@/theme';
import { usePreviewDetect } from '@/features/routes/hooks/usePreviewDetect';
import { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
import { usePreviewCentres } from '@/features/routes/hooks/usePreviewCentres';
import { usePreviewCurrentSections } from '@/features/routes/hooks/usePreviewCurrentSections';
import {
  PreviewCentrePicker,
  PreviewDiffStrip,
  PreviewMapView,
  PreviewParamPanel,
  PreviewSectionPopover,
} from '@/features/routes/components';
import { getEngine, UNIFIED_CONFIG } from '@/shared/native/engine';
import type {
  PreviewCentre,
  PreviewParams,
  PreviewSection,
} from '../../modules/veloqrs/src/delegates/preview';

export default function DetectionPreviewScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const client = useMemo(() => getEngine(), []);
  const { centres, labels } = usePreviewCentres(client);
  const { status, progress, result, suspended, start, cancel } = usePreviewDetect(client);
  const { forceRescan } = useSectionRescan();

  const [centre, setCentre] = useState<PreviewCentre | null>(null);
  const [params, setParams] = useState<PreviewParams>(() => {
    const config = client?.getSectionConfig();
    if (!config) return UNIFIED_CONFIG;
    return {
      proximityThreshold: config.proximityThreshold,
      minSectionLength: config.minSectionLength,
      maxSectionLength: config.maxSectionLength,
      minActivities: config.minActivities,
      divergenceThreshold: config.divergenceThreshold,
    };
  });
  const [selected, setSelected] = useState<PreviewSection | null>(null);
  const [showCurrent, setShowCurrent] = useState(true);
  const [showProposed, setShowProposed] = useState(true);

  const bg = isDark ? darkColors.background : colors.background;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const danger = isDark ? darkColors.error : colors.error;

  const selectedCentre = centre ?? centres[0] ?? null;
  const currentSections = usePreviewCurrentSections(client, selectedCentre);
  const running = status === 'running';
  // The engine reports a percentage for a bounded job, so draw it. Clamped
  // because a phase that finishes ahead of its own estimate can overshoot.
  const runPercent = Math.min(100, Math.max(0, Math.round(progress?.percent ?? 0)));

  const handlePreview = useCallback(() => {
    if (!selectedCentre || running) return;
    setSelected(null);
    start(selectedCentre.lat, selectedCentre.lng, params);
  }, [selectedCentre, running, start, params]);

  const handleKeep = useCallback(() => {
    Alert.alert(t('settings.previewKeepTitle'), t('settings.previewKeepWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        onPress: () => {
          const config = client?.getSectionConfig();
          if (!client || !config) return;
          client.setSectionConfig({ ...config, ...params });
          // Through the rescan hook, not the client: the re-cut is global and
          // the athlete has to be able to see it run, and the hook is what
          // starts the poll every progress indicator reads.
          //
          // The engine refuses a re-cut while a detect runs or the elevation
          // backfill holds detection. The config above is already written and
          // the evidence cache already cleared, so closing here would report a
          // change that never ran. Stay, say why, and let Keep be pressed again.
          if (!forceRescan()) {
            Alert.alert(t('settings.previewKeepRefusedTitle'), t('settings.previewKeepRefused'));
            return;
          }
          router.back();
        },
      },
    ]);
  }, [t, client, params, forceRescan]);

  const handleDiscard = useCallback(() => {
    if (running) cancel();
    router.back();
  }, [running, cancel]);

  return (
    <ScreenSafeAreaView
      testID="detection-preview-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          testID="detection-preview-back"
          onPress={handleDiscard}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>
          {t('settings.previewSections')}
        </Text>
      </View>

      <View style={styles.map} testID="preview-map">
        <PreviewMapView
          result={result}
          currentSections={currentSections}
          centre={selectedCentre}
          selectedId={selected?.id ?? null}
          showCurrent={showCurrent}
          showProposed={showProposed}
          onToggleCurrent={() => setShowCurrent((v) => !v)}
          onToggleProposed={() => setShowProposed((v) => !v)}
          onSelect={setSelected}
        />
        {selected && (
          <View style={styles.popover} pointerEvents="box-none">
            <PreviewSectionPopover section={selected} onClose={() => setSelected(null)} />
          </View>
        )}
      </View>

      <View
        style={[styles.panel, { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING }]}
        testID="preview-control-panel"
      >
        <View style={styles.pickerWrap}>
          <PreviewCentrePicker
            centres={centres}
            labels={labels}
            selectedBinKey={selectedCentre?.binKey ?? null}
            onSelect={(c) => setCentre(c)}
          />
        </View>

        <PreviewParamPanel params={params} onChange={setParams} disabled={running} />

        {result && <PreviewDiffStrip counts={result.counts} />}

        {running ? (
          <View>
            <View style={[styles.runBtn, { backgroundColor: surface, borderColor: border }]}>
              <ActivityIndicator size="small" color={textSecondary} />
              <Text style={[styles.runText, { color: textSecondary }]} numberOfLines={1}>
                {progress?.phase === 'loading'
                  ? t('settings.previewRunning', { count: progress.total })
                  : (progress?.displayName ?? t('settings.previewRun'))}
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: border }]}>
              <View
                testID="preview-progress-fill"
                style={[
                  styles.progressFill,
                  { backgroundColor: brand.tealLight, width: `${runPercent}%` },
                ]}
              />
            </View>
          </View>
        ) : (
          // One row, so a result does not cost a second. Keep takes the accent
          // once there is something to keep, and Preview steps back to
          // secondary rather than competing with it.
          <View style={styles.actionRow}>
            {result && (
              <Pressable
                style={[styles.actionBtn, { backgroundColor: surface, borderColor: border }]}
                onPress={handleDiscard}
                testID="preview-discard-button"
              >
                <Text style={[styles.runText, { color: textSecondary }]} numberOfLines={1}>
                  {t('settings.previewDiscard')}
                </Text>
              </Pressable>
            )}
            <Pressable
              style={[
                styles.actionBtn,
                selectedCentre && !result
                  ? { backgroundColor: brand.tealLight, borderColor: brand.tealLight }
                  : { backgroundColor: surface, borderColor: border },
              ]}
              onPress={handlePreview}
              disabled={!selectedCentre}
              testID="preview-run-button"
            >
              <MaterialCommunityIcons
                name="magnify-scan"
                size={18}
                color={selectedCentre && !result ? colors.textOnDark : textSecondary}
              />
              <Text
                style={[
                  styles.runText,
                  { color: selectedCentre && !result ? colors.textOnDark : textSecondary },
                ]}
                numberOfLines={1}
              >
                {t('settings.previewRun')}
              </Text>
            </Pressable>
            {result && (
              <Pressable
                style={[styles.actionBtn, styles.keepBtn]}
                onPress={handleKeep}
                testID="preview-keep-button"
              >
                <Text style={[styles.runText, styles.keepText]} numberOfLines={1}>
                  {t('settings.previewKeep')}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {status === 'error' && (
          <Text style={[styles.notice, { color: danger }]}>{t('settings.previewFailed')}</Text>
        )}
        {status === 'pool_unusable' && (
          <Text style={[styles.notice, { color: danger }]} testID="preview-pool-unusable">
            {t('settings.previewPoolUnusable')}
          </Text>
        )}
        {suspended && (
          <Text style={[styles.notice, { color: textSecondary }]}>
            {t('settings.previewSuspended')}
          </Text>
        )}
      </View>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  map: {
    height: '30%',
  },
  popover: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  panel: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  pickerWrap: {
    marginHorizontal: -spacing.md,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadius,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: layout.minTapTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  runText: {
    ...typography.body,
    fontWeight: '600',
  },
  notice: {
    ...typography.bodySmall,
    textAlign: 'center',
  },
  keepBtn: {
    backgroundColor: brand.tealLight,
    borderColor: brand.tealLight,
  },
  keepText: {
    color: colors.textOnDark,
  },
});
