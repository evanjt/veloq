import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouteSettings } from '@/providers';
import { applyDetectionStrictness, getRouteEngine } from '@/lib/native/routeEngine';
import { colors, darkColors, spacing } from '@/theme';
import { settingsStyles } from './settingsStyles';

const PRESETS = [
  { key: 'detectionRelaxed', value: 20, matchPct: 55, endpoint: 270 },
  { key: 'default', value: 60, matchPct: 65, endpoint: 210 },
  { key: 'detectionStrict', value: 90, matchPct: 72.5, endpoint: 165 },
] as const;

export function SectionDetectionSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { settings, setDetectionStrictness } = useRouteSettings();
  const [pruneResult, setPruneResult] = useState<number | null>(null);

  const activePreset = useMemo(
    () =>
      PRESETS.reduce((closest, p) =>
        Math.abs(p.value - settings.detectionStrictness) <
        Math.abs(closest.value - settings.detectionStrictness)
          ? p
          : closest
      ),
    [settings.detectionStrictness]
  );

  useEffect(() => {
    if (pruneResult === null) return;
    const timer = setTimeout(() => setPruneResult(null), 3000);
    return () => clearTimeout(timer);
  }, [pruneResult]);

  const handlePresetSelect = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      setDetectionStrictness(preset.value);
      applyDetectionStrictness(preset.value);
    },
    [setDetectionStrictness]
  );

  const handleReanalyze = useCallback(() => {
    Alert.alert(t('settings.reanalyzeSections'), t('settings.reanalyzeWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        onPress: () => {
          getRouteEngine()?.forceRedetectSections();
        },
      },
    ]);
  }, [t]);

  const handlePrune = useCallback(() => {
    const count = getRouteEngine()?.pruneOverlappingSections() ?? 0;
    setPruneResult(count);
  }, []);

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.sectionDetection').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <View style={settingsStyles.actionRow}>
          <MaterialCommunityIcons
            name="tune-variant"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <View style={{ flex: 1 }}>
            <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
              {t('settings.detectionSensitivity')}
            </Text>
            <View style={localStyles.presetRow}>
              {PRESETS.map((p) => {
                const isActive = p.value === activePreset.value;
                const label = p.key === 'default' ? t('settings.default') : t(`settings.${p.key}`);
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[
                      localStyles.presetChip,
                      {
                        borderColor: isActive ? colors.primary : isDark ? '#374151' : '#D1D5DB',
                        backgroundColor: isActive
                          ? isDark
                            ? 'rgba(252, 76, 2, 0.15)'
                            : 'rgba(252, 76, 2, 0.08)'
                          : 'transparent',
                      },
                    ]}
                    onPress={() => handlePresetSelect(p)}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: isActive ? '600' : '400',
                        color: isActive
                          ? colors.primary
                          : isDark
                            ? darkColors.textSecondary
                            : colors.textSecondary,
                      }}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text
              style={{
                fontSize: 11,
                color: isDark ? darkColors.textDisabled : colors.textDisabled,
                marginTop: 4,
              }}
            >
              {t('settings.matchThreshold', { pct: activePreset.matchPct })}
              {'  '}
              {t('settings.endpointDistance', { meters: activePreset.endpoint })}
            </Text>
          </View>
        </View>

        <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />

        <TouchableOpacity style={settingsStyles.actionRow} onPress={handleReanalyze}>
          <MaterialCommunityIcons
            name="refresh"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
            {t('settings.reanalyzeSections')}
          </Text>
        </TouchableOpacity>

        <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />

        <TouchableOpacity style={settingsStyles.actionRow} onPress={handlePrune}>
          <MaterialCommunityIcons
            name="set-merge"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
            {t('settings.cleanupOverlapping')}
          </Text>
          {pruneResult !== null && (
            <Text
              style={{
                fontSize: 12,
                color: isDark ? darkColors.textSecondary : colors.textSecondary,
              }}
            >
              {t('settings.cleanupResult', { count: pruneResult })}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

const localStyles = StyleSheet.create({
  presetRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
});
