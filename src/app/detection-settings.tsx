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
import { useTheme } from '@/hooks';
import { useRouteSettings } from '@/providers';
import { useSectionRescan } from '@/hooks/routes/useSectionRescan';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { DetectionMethodIllustration } from '@/components/settings';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import {
  DETECTION_PRESETS,
  applyDetectionPresetForMethod,
  getDetectionPresetByValue,
  getRouteEngine,
  CORRIDOR_PRESETS,
  DENSITY_GRID_PRESETS,
  FLOW_GRAPH_PRESETS,
  type DetectionMethod,
  type DetectionStrictness,
} from '@/lib/native/routeEngine';

const METHOD_LABELS: { key: DetectionMethod; label: string }[] = [
  { key: 'corridor', label: 'settings.methodCorridor' },
  { key: 'density', label: 'settings.methodDensity' },
  { key: 'flow', label: 'settings.methodFlow' },
];

const METHOD_DESCS: Record<DetectionMethod, string> = {
  corridor: 'settings.methodCorridorDesc',
  density: 'settings.methodDensityDesc',
  flow: 'settings.methodFlowDesc',
};

type MethodParams = {
  proximityThreshold: number;
  minSectionLength: number;
  minActivities: number;
  minCorridorTracks: number;
  minRoutes: number;
  jaccardThreshold: number;
  minCellVisits: number;
  divergenceThreshold: number;
};

function paramsForMethod(method: DetectionMethod, strictness: DetectionStrictness): MethodParams {
  const corridor = CORRIDOR_PRESETS[strictness];
  const density = DENSITY_GRID_PRESETS[strictness];
  const flow = FLOW_GRAPH_PRESETS[strictness];
  if (method === 'corridor') {
    return {
      proximityThreshold: corridor.proximityThreshold,
      minSectionLength: corridor.minSectionLength,
      minActivities: corridor.minActivities,
      minCorridorTracks: corridor.minCorridorTracks,
      minRoutes: density.minRoutes,
      jaccardThreshold: density.jaccardThreshold,
      minCellVisits: flow.minCellVisits,
      divergenceThreshold: flow.divergenceThreshold,
    };
  }
  if (method === 'density') {
    return {
      proximityThreshold: density.proximityThreshold,
      minSectionLength: density.minSectionLength,
      minActivities: density.minActivities,
      minCorridorTracks: corridor.minCorridorTracks,
      minRoutes: density.minRoutes,
      jaccardThreshold: density.jaccardThreshold,
      minCellVisits: flow.minCellVisits,
      divergenceThreshold: flow.divergenceThreshold,
    };
  }
  return {
    proximityThreshold: flow.proximityThreshold,
    minSectionLength: flow.minSectionLength,
    minActivities: flow.minActivities,
    minCorridorTracks: corridor.minCorridorTracks,
    minRoutes: density.minRoutes,
    jaccardThreshold: density.jaccardThreshold,
    minCellVisits: flow.minCellVisits,
    divergenceThreshold: flow.divergenceThreshold,
  };
}

/** Params that are user-visible (and dirty-tracked) for the active method. */
function visibleKeysForMethod(method: DetectionMethod): (keyof MethodParams)[] {
  const shared: (keyof MethodParams)[] = [
    'proximityThreshold',
    'minSectionLength',
    'minActivities',
  ];
  if (method === 'corridor') return [...shared, 'minCorridorTracks'];
  if (method === 'density') return [...shared, 'minRoutes', 'jaccardThreshold'];
  return [...shared, 'minCellVisits', 'divergenceThreshold'];
}

export default function DetectionSettingsScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const method = useRouteSettings((s) => s.settings.detectionMethod);
  const strictnessValue = useRouteSettings((s) => s.settings.detectionStrictness);
  const routeMatchingEnabled = useRouteSettings((s) => s.settings.enabled);
  const setRouteMatchingEnabled = useRouteSettings((s) => s.setEnabled);
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const activePreset = useMemo(() => getDetectionPresetByValue(strictnessValue), [strictnessValue]);
  const activeStrictness: DetectionStrictness = activePreset.strictness;
  const activePresetIndex = useMemo(
    () => DETECTION_PRESETS.findIndex((p) => p.key === activePreset.key),
    [activePreset]
  );

  const [params, setParams] = useState<MethodParams>(() =>
    paramsForMethod(method, activeStrictness)
  );

  const handleMethodSelect = useCallback(
    (m: DetectionMethod) => {
      useRouteSettings.getState().setDetectionMethod(m);
      // Re-seed visible param state and push to engine in one go.
      applyDetectionPresetForMethod(m, activeStrictness);
      setParams(paramsForMethod(m, activeStrictness));
    },
    [activeStrictness]
  );

  const handlePresetSelect = useCallback(
    (index: number) => {
      const preset = DETECTION_PRESETS[index];
      useRouteSettings.getState().setDetectionStrictness(preset.value);
      applyDetectionPresetForMethod(method, preset.strictness);
      setParams(paramsForMethod(method, preset.strictness));
    },
    [method]
  );

  const applyParam = useCallback((key: keyof MethodParams, value: number) => {
    const engine = getRouteEngine();
    if (!engine) return;
    const config = engine.getSectionConfig();
    if (!config) return;
    engine.setSectionConfig({ ...config, [key]: value });
  }, []);

  const setParam = useCallback(
    (key: keyof MethodParams, value: number) => {
      setParams((prev) => ({ ...prev, [key]: value }));
      applyParam(key, value);
    },
    [applyParam]
  );

  // Track initial config to detect changes. Reset when the user switches method
  // so the rescan button only lights up for unsaved tweaks to the *current*
  // method's params, not for method switches (which apply immediately).
  const initialConfig = useRef<{
    method: DetectionMethod;
    params: MethodParams;
  }>({
    method,
    params,
  });
  useEffect(() => {
    initialConfig.current = {
      method,
      params: paramsForMethod(method, activeStrictness),
    };
    // Only reset when method/strictness changes — not on every param tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, activeStrictness]);

  const isDirty = useMemo(() => {
    if (method !== initialConfig.current.method) return true;
    const visible = visibleKeysForMethod(method);
    for (const k of visible) {
      if (params[k] !== initialConfig.current.params[k]) return true;
    }
    return false;
  }, [method, params]);

  const {
    forceRescan,
    isScanning,
    progress: rescanProgress,
    result: rescanResult,
    clearResult,
  } = useSectionRescan();

  useEffect(() => {
    if (rescanResult === null) return;
    initialConfig.current = { method, params };
    const timer = setTimeout(clearResult, 5000);
    return () => clearTimeout(timer);
  }, [rescanResult, clearResult, method, params]);

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

          <DetectionMethodIllustration
            method={method}
            proximity={params.proximityThreshold}
            minSectionLength={params.minSectionLength}
            minActivities={params.minActivities}
            minCorridorTracks={params.minCorridorTracks}
            minRoutes={params.minRoutes}
            jaccardThreshold={params.jaccardThreshold}
            minCellVisits={params.minCellVisits}
            divergenceThreshold={params.divergenceThreshold}
          />

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

          <View style={[styles.paramsCard, { backgroundColor: surface, borderColor: border }]}>
            <ParamRow
              label={t('settings.sectionProximity', {
                meters: params.proximityThreshold,
              })}
              value={params.proximityThreshold}
              min={25}
              max={300}
              step={25}
              onChange={(v) => setParam('proximityThreshold', v)}
              isDark={isDark}
            />
            <ParamRow
              label={t('settings.sectionMinLength', {
                meters: params.minSectionLength,
              })}
              value={params.minSectionLength}
              min={50}
              max={2000}
              step={50}
              onChange={(v) => setParam('minSectionLength', v)}
              isDark={isDark}
            />
            <ParamRow
              label={t('settings.sectionMinActivities', {
                count: params.minActivities,
              })}
              value={params.minActivities}
              min={2}
              max={10}
              step={1}
              onChange={(v) => setParam('minActivities', v)}
              isDark={isDark}
            />

            {method === 'corridor' && (
              <ParamRow
                label={t('settings.sectionMinCorridorTracks', {
                  count: params.minCorridorTracks,
                })}
                value={params.minCorridorTracks}
                min={2}
                max={8}
                step={1}
                onChange={(v) => setParam('minCorridorTracks', v)}
                isDark={isDark}
              />
            )}

            {method === 'density' && (
              <>
                <ParamRow
                  label={t('settings.sectionMinRoutes', {
                    count: params.minRoutes,
                  })}
                  value={params.minRoutes}
                  min={2}
                  max={6}
                  step={1}
                  onChange={(v) => setParam('minRoutes', v)}
                  isDark={isDark}
                />
                <ParamRow
                  label={t('settings.sectionJaccard', {
                    value: params.jaccardThreshold.toFixed(2),
                  })}
                  value={params.jaccardThreshold}
                  min={0.2}
                  max={0.8}
                  step={0.05}
                  onChange={(v) => setParam('jaccardThreshold', v)}
                  isDark={isDark}
                />
              </>
            )}

            {method === 'flow' && (
              <>
                <ParamRow
                  label={t('settings.sectionMinCellVisits', {
                    count: params.minCellVisits,
                  })}
                  value={params.minCellVisits}
                  min={10}
                  max={150}
                  step={5}
                  onChange={(v) => setParam('minCellVisits', v)}
                  isDark={isDark}
                />
                <ParamRow
                  label={t('settings.sectionDivergence', {
                    value: params.divergenceThreshold.toFixed(2),
                  })}
                  value={params.divergenceThreshold}
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  onChange={(v) => setParam('divergenceThreshold', v)}
                  isDark={isDark}
                />
              </>
            )}
          </View>

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
