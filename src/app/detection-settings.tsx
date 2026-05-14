import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useRouteSettings } from '@/providers';
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

  const method = useRouteSettings((s) => s.settings.detectionMethod);
  const strictness = useRouteSettings((s) => s.settings.detectionStrictness);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const bg = isDark ? darkColors.background : colors.background;

  const activePreset = useMemo(() => getDetectionPresetByValue(strictness), [strictness]);
  const activePresetIndex = useMemo(
    () => DETECTION_PRESETS.findIndex((p) => p.key === activePreset.key),
    [activePreset]
  );

  // Local slider state (synced from preset, editable individually)
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
    <ScrollView
      style={[styles.container, { backgroundColor: bg }]}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: t('settings.sectionDetection') }} />

      {/* Method selector chips */}
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
                style={[styles.chipText, { color: textSecondary }, active && styles.chipTextActive]}
              >
                {t(m.label as never)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Description for active method */}
      <Text style={[styles.modeDescription, { color: textSecondary }]}>
        {t(METHOD_DESCS[method] as never)}
      </Text>

      {/* Illustration */}
      <DetectionMethodIllustration method={method} />

      {/* Strictness presets */}
      <Text style={[styles.sectionLabel, { color: textSecondary }, styles.sectionLabelSpaced]}>
        {t('settings.detectionSensitivity')}
      </Text>

      <View style={styles.chipRow}>
        {DETECTION_PRESETS.map((p, i) => {
          const label = p.key === 'default' ? t('settings.default') : t(`settings.${p.key}`);
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
                style={[styles.chipText, { color: textSecondary }, active && styles.chipTextActive]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Individual parameter sliders */}
      <View style={[styles.slidersContainer, { backgroundColor: surface, borderColor: border }]}>
        <SliderRow
          label={t('settings.sectionProximity', { meters: proximityThreshold })}
          value={proximityThreshold}
          min={25}
          max={300}
          step={25}
          onValueChange={(v) => {
            setProximityThreshold(v);
          }}
          onSlidingComplete={applySliderValues}
          isDark={isDark}
        />
        <SliderRow
          label={t('settings.sectionMinLength', { meters: minSectionLength })}
          value={minSectionLength}
          min={50}
          max={2000}
          step={50}
          onValueChange={(v) => {
            setMinSectionLength(v);
          }}
          onSlidingComplete={applySliderValues}
          isDark={isDark}
        />
        <SliderRow
          label={t('settings.sectionMinActivities', { count: minActivities })}
          value={minActivities}
          min={2}
          max={10}
          step={1}
          onValueChange={(v) => {
            setMinActivities(v);
          }}
          onSlidingComplete={applySliderValues}
          isDark={isDark}
        />
        <SliderRow
          label={t('settings.sectionMinRoutes', { count: minRoutes })}
          value={minRoutes}
          min={2}
          max={6}
          step={1}
          onValueChange={(v) => {
            setMinRoutes(v);
          }}
          onSlidingComplete={applySliderValues}
          isDark={isDark}
        />
      </View>
    </ScrollView>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onValueChange,
  onSlidingComplete,
  isDark,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (v: number) => void;
  onSlidingComplete: () => void;
  isDark: boolean;
}) {
  const textColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const trackColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  // React Native Slider is not available by default, use a simple numeric stepper
  return (
    <View style={styles.sliderRow}>
      <Text style={[styles.sliderLabel, { color: textColor }]}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable
          style={[styles.stepperBtn, { backgroundColor: trackColor }]}
          onPress={() => {
            if (value > min) onValueChange(value - step);
            onSlidingComplete();
          }}
        >
          <Text style={[styles.stepperBtnText, { color: textColor }]}>-</Text>
        </Pressable>
        <Text style={[styles.stepperValue, { color: textColor }]}>{value}</Text>
        <Pressable
          style={[styles.stepperBtn, { backgroundColor: trackColor }]}
          onPress={() => {
            if (value < max) onValueChange(value + step);
            onSlidingComplete();
          }}
        >
          <Text style={[styles.stepperBtnText, { color: textColor }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  sectionLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  sectionLabelSpaced: { marginTop: spacing.lg },
  modeDescription: {
    ...typography.bodySmall,
    marginTop: 4,
    marginBottom: 4,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
  slidersContainer: {
    marginTop: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.md,
  },
  sliderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderLabel: {
    ...typography.bodySmall,
    flex: 1,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 18,
    fontWeight: '600',
  },
  stepperValue: {
    ...typography.bodySmall,
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'center',
  },
});
