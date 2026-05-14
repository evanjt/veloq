import React, { useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useRouteSettings } from '@/providers';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { DetectionMethodIllustration } from '@/components/settings';
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

type MName = 'settings.methodCorridor' | 'settings.methodDensity' | 'settings.methodFlow';
type MDesc =
  | 'settings.methodCorridorDesc'
  | 'settings.methodDensityDesc'
  | 'settings.methodFlowDesc';

const METHODS: { key: Method; name: MName; desc: MDesc }[] = [
  { key: 'corridor', name: 'settings.methodCorridor', desc: 'settings.methodCorridorDesc' },
  { key: 'density', name: 'settings.methodDensity', desc: 'settings.methodDensityDesc' },
  { key: 'flow', name: 'settings.methodFlow', desc: 'settings.methodFlowDesc' },
];

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
  }, []);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: bg }]}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: t('settings.sectionDetection') }} />

      {/* Method selector */}
      <Text style={[styles.sectionLabel, { color: textSecondary }]}>
        {t('settings.detectionMethodLabel')}
      </Text>

      {METHODS.map((m) => {
        const selected = method === m.key;
        return (
          <Pressable
            key={m.key}
            style={[
              styles.methodCard,
              { backgroundColor: surface, borderColor: border },
              selected && styles.methodCardSelected,
            ]}
            onPress={() => handleMethodSelect(m.key)}
          >
            <Text style={[styles.methodName, { color: textPrimary }]}>{t(m.name)}</Text>
            <Text style={[styles.methodDesc, { color: textSecondary }]}>{t(m.desc)}</Text>
          </Pressable>
        );
      })}

      {/* Method illustration */}
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

      {/* Parameter summary */}
      <Text style={[styles.paramSummary, { color: textSecondary }]}>
        {t('settings.sectionProximity', { meters: activePreset.proximityThreshold })}
        {'  '}
        {t('settings.sectionMinLength', { meters: activePreset.minSectionLength })}
        {'  '}
        {t('settings.sectionMinActivities', { count: activePreset.minActivities })}
      </Text>
    </ScrollView>
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
  methodCard: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  methodCardSelected: { borderLeftColor: brand.orange },
  methodName: {
    ...typography.bodyBold,
    marginBottom: 2,
  },
  methodDesc: { ...typography.bodySmall },
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
  paramSummary: { ...typography.caption, marginTop: spacing.sm },
});
