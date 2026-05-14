import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks';
import { useRouteSettings } from '@/providers';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { DetectionMethodIllustration } from '@/components/settings';
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

  const applySliderValues = useCallback(() => {
    const engine = getRouteEngine();
    if (engine) {
      const config = engine.getSectionConfig();
      if (config) {
        engine.setSectionConfig({
          ...config,
          proximityThreshold,
          minSectionLength,
          minActivities,
          minRoutes,
        });
      }
    }
  }, [proximityThreshold, minSectionLength, minActivities, minRoutes]);

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
              applySliderValues();
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
              applySliderValues();
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
              applySliderValues();
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
              applySliderValues();
            }}
            isDark={isDark}
          />
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
  const btnBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <View style={styles.paramRow}>
      <Text style={[styles.paramLabel, { color: txt }]}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          style={[styles.stepBtn, { backgroundColor: btnBg }]}
          onPress={() => value > min && onChange(value - step)}
        >
          <MaterialCommunityIcons name="minus" size={16} color={txt} />
        </Pressable>
        <Pressable
          style={[styles.stepBtn, { backgroundColor: btnBg }]}
          onPress={() => value < max && onChange(value + step)}
        >
          <MaterialCommunityIcons name="plus" size={16} color={txt} />
        </Pressable>
      </View>
    </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 40,
  },
  paramLabel: {
    ...typography.bodySmall,
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
