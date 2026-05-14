import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '@/hooks';
import { useRouteSettings } from '@/providers';
import { useSectionRescan } from '@/hooks/routes/useSectionRescan';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { DetectionMethodIllustration } from '@/components/settings';
import { HEATMAP_TILES_DIR } from '@/hooks/maps/useHeatmapTiles';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import {
  DETECTION_PRESETS,
  applyDetectionPreset,
  getDetectionPresetByValue,
  getRouteEngine,
} from '@/lib/native/routeEngine';

type Method = 'corridor' | 'density' | 'flow';

const FFI_KEYS: Record<Method, string> = {
  corridor: 'corridor',
  density: 'density_grid',
  flow: 'flow_graph',
};

const METHOD_LABELS: { key: Method; label: string }[] = [
  { key: 'corridor', label: 'settings.methodCorridor' },
  { key: 'density', label: 'settings.methodDensity' },
  { key: 'flow', label: 'settings.methodFlow' },
];

const METHOD_DESCS: Record<Method, string> = {
  corridor: 'settings.methodCorridorDesc',
  density: 'settings.methodDensityDesc',
  flow: 'settings.methodFlowDesc',
};

export default function DetectionSettingsScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const method = useRouteSettings((s) => s.settings.detectionMethod);
  const strictness = useRouteSettings((s) => s.settings.detectionStrictness);
  const routeMatchingEnabled = useRouteSettings((s) => s.settings.enabled);
  const setRouteMatchingEnabled = useRouteSettings((s) => s.setEnabled);
  const heatmapEnabled = useRouteSettings((s) => s.settings.heatmapEnabled);
  const setHeatmapEnabled = useRouteSettings((s) => s.setHeatmapEnabled);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const activePreset = useMemo(() => getDetectionPresetByValue(strictness), [strictness]);
  const activePresetIndex = useMemo(
    () => DETECTION_PRESETS.findIndex((p) => p.key === activePreset.key),
    [activePreset]
  );

  const [proximityThreshold, setProximityThreshold] = useState(activePreset.proximityThreshold);
  const [minSectionLength, setMinSectionLength] = useState(activePreset.minSectionLength);
  const [minActivities, setMinActivities] = useState(activePreset.minActivities);
  const [minRoutes, setMinRoutes] = useState(activePreset.minRoutes);

  const handleMethodSelect = useCallback((m: Method) => {
    useRouteSettings.getState().setDetectionMethod(m);
    const engine = getRouteEngine();
    if (engine) {
      const config = engine.getSectionConfig();
      if (config) {
        engine.setSectionConfig({ ...config, detectionMethod: FFI_KEYS[m] });
      }
    }
  }, []);

  const handlePresetSelect = useCallback((index: number) => {
    const preset = DETECTION_PRESETS[index];
    useRouteSettings.getState().setDetectionStrictness(preset.value);
    applyDetectionPreset(preset);
    setProximityThreshold(preset.proximityThreshold);
    setMinSectionLength(preset.minSectionLength);
    setMinActivities(preset.minActivities);
    setMinRoutes(preset.minRoutes);
  }, []);

  const applyParam = useCallback((key: string, value: number) => {
    const engine = getRouteEngine();
    if (engine) {
      const config = engine.getSectionConfig();
      if (config) {
        engine.setSectionConfig({ ...config, [key]: value });
      }
    }
  }, []);

  // Track initial config to detect changes
  const initialConfig = useRef({
    method,
    proximityThreshold,
    minSectionLength,
    minActivities,
    minRoutes,
  });

  const isDirty = useMemo(() => {
    const init = initialConfig.current;
    return (
      method !== init.method ||
      proximityThreshold !== init.proximityThreshold ||
      minSectionLength !== init.minSectionLength ||
      minActivities !== init.minActivities ||
      minRoutes !== init.minRoutes
    );
  }, [method, proximityThreshold, minSectionLength, minActivities, minRoutes]);

  const {
    forceRescan,
    isScanning,
    progress: rescanProgress,
    result: rescanResult,
    clearResult,
  } = useSectionRescan();

  useEffect(() => {
    if (rescanResult === null) return;
    initialConfig.current = {
      method,
      proximityThreshold,
      minSectionLength,
      minActivities,
      minRoutes,
    };
    const timer = setTimeout(clearResult, 5000);
    return () => clearTimeout(timer);
  }, [
    rescanResult,
    clearResult,
    method,
    proximityThreshold,
    minSectionLength,
    minActivities,
    minRoutes,
  ]);

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
        {/* Master toggles */}
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
          <View style={[styles.toggleDivider, { backgroundColor: border }]} />
          <View style={styles.toggleRow}>
            <MaterialCommunityIcons name="map-legend" size={22} color={textSecondary} />
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.toggleLabel, { color: textPrimary }]}>
                {t('settings.heatmapGeneration', 'Heatmap')}
              </Text>
              <Text style={[styles.toggleHint, { color: textSecondary }]}>
                {t('settings.heatmapDescription', 'Uses device storage. Disable to save space.')}
              </Text>
            </View>
            <Switch
              value={heatmapEnabled}
              onValueChange={(enabled) => {
                setHeatmapEnabled(enabled);
                if (enabled) {
                  getRouteEngine()?.enableHeatmapTiles();
                } else {
                  getRouteEngine()?.clearHeatmapTiles(HEATMAP_TILES_DIR);
                  const legacyDir = `${FileSystem.documentDirectory}heatmap-tiles/`;
                  getRouteEngine()?.clearHeatmapTiles(legacyDir);
                  getRouteEngine()?.disableHeatmapTiles();
                }
              }}
              color={colors.primary}
            />
          </View>
        </View>

        {/* Detection parameters (dimmed when route matching is off) */}
        <View
          style={{ opacity: routeMatchingEnabled ? 1 : 0.4 }}
          pointerEvents={routeMatchingEnabled ? 'auto' : 'none'}
        >
          {/* Method chips */}
          <View style={styles.chipRow} testID="detection-method-chips">
            {METHOD_LABELS.map((m) => {
              const active = method === m.key;
              return (
                <Pressable
                  key={m.key}
                  style={[
                    styles.chip,
                    { borderColor: border, backgroundColor: surface },
                    active && styles.chipActive,
                  ]}
                  onPress={() => handleMethodSelect(m.key)}
                  testID={`detection-method-${m.key}`}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: textSecondary },
                      active && styles.chipTextActive,
                    ]}
                  >
                    {t(m.label as never)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.modeDescription, { color: textSecondary }]}>
            {t(METHOD_DESCS[method] as never)}
          </Text>

          {/* Illustration (reactive to all parameters) */}
          <DetectionMethodIllustration
            method={method}
            proximity={proximityThreshold}
            minSectionLength={minSectionLength}
            minActivities={minActivities}
            minRoutes={minRoutes}
          />

          {/* Presets */}
          <Text style={[styles.sectionLabel, { color: textSecondary }]}>
            {t('settings.detectionSensitivity')}
          </Text>
          <View style={styles.chipRow}>
            {DETECTION_PRESETS.map((p, i) => {
              const label =
                p.key === 'default' ? t('settings.default') : t(`settings.${p.key}` as never);
              const active = i === activePresetIndex;
              return (
                <Pressable
                  key={p.key}
                  style={[
                    styles.chip,
                    { borderColor: border, backgroundColor: surface },
                    active && styles.chipActive,
                  ]}
                  onPress={() => handlePresetSelect(i)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: textSecondary },
                      active && styles.chipTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Parameter controls */}
          <View style={[styles.paramsCard, { backgroundColor: surface, borderColor: border }]}>
            <ParamRow
              label={t('settings.sectionProximity', { meters: proximityThreshold })}
              value={proximityThreshold}
              min={25}
              max={300}
              step={25}
              onChange={(v) => {
                setProximityThreshold(v);
                applyParam('proximityThreshold', v);
              }}
              isDark={isDark}
            />
            <ParamRow
              label={t('settings.sectionMinLength', { meters: minSectionLength })}
              value={minSectionLength}
              min={50}
              max={2000}
              step={50}
              onChange={(v) => {
                setMinSectionLength(v);
                applyParam('minSectionLength', v);
              }}
              isDark={isDark}
            />
            <ParamRow
              label={t('settings.sectionMinActivities', { count: minActivities })}
              value={minActivities}
              min={2}
              max={10}
              step={1}
              onChange={(v) => {
                setMinActivities(v);
                applyParam('minActivities', v);
              }}
              isDark={isDark}
            />
            <ParamRow
              label={t('settings.sectionMinRoutes', { count: minRoutes })}
              value={minRoutes}
              min={2}
              max={6}
              step={1}
              onChange={(v) => {
                setMinRoutes(v);
                applyParam('minRoutes', v);
              }}
              isDark={isDark}
            />
          </View>

          {/* Rescan button, bright when settings changed */}
          <Pressable
            style={[
              styles.rescanBtn,
              isDirty && !isScanning
                ? { backgroundColor: brand.orange }
                : {
                    backgroundColor: surface,
                    borderColor: border,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
            ]}
            onPress={handleRescan}
            disabled={isScanning}
            testID="detection-rescan-button"
          >
            {isScanning ? (
              <ActivityIndicator size="small" color={textSecondary} />
            ) : (
              <>
                <MaterialCommunityIcons
                  name="refresh"
                  size={18}
                  color={isDirty ? '#fff' : textSecondary}
                />
                <Text style={[styles.rescanText, { color: isDirty ? '#fff' : textSecondary }]}>
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
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

function ParamRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  isDark,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  isDark: boolean;
}) {
  const txt = isDark ? darkColors.textSecondary : colors.textSecondary;
  const trackBg = isDark ? '#333' : '#ddd';
  return (
    <View style={styles.paramRow}>
      <Text style={[styles.paramLabel, { color: txt }]}>{label}</Text>
      <Slider
        style={styles.slider}
        value={value}
        minimumValue={min}
        maximumValue={max}
        step={step}
        onValueChange={onChange}
        minimumTrackTintColor={brand.orange}
        maximumTrackTintColor={trackBg}
        thumbTintColor={brand.orange}
      />
    </View>
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
  toggleTextWrap: {
    flex: 1,
  },
  toggleHint: {
    ...typography.caption,
    marginTop: 2,
  },
  toggleDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.md + 22 + spacing.sm,
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
  sectionLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  modeDescription: {
    ...typography.bodySmall,
    marginTop: 4,
    marginBottom: 4,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipActive: {
    backgroundColor: brand.orange,
    borderColor: brand.orange,
  },
  chipText: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  chipTextActive: { color: '#FFFFFF' },
  paramsCard: {
    marginTop: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  paramRow: {
    gap: 2,
  },
  paramLabel: {
    ...typography.bodySmall,
  },
  slider: {
    width: '100%',
    height: 36,
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
});
