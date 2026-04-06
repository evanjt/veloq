import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';

const FORM_ZONE_COLORS = {
  highRisk: '#EF5350',
  optimal: '#66BB6A',
  greyZone: '#9E9E9E',
  fresh: '#81C784',
  transition: '#64B5F6',
};

const HERO_METRICS = [
  { labelKey: 'fitness.fitAbbrev', value: '78', color: colors.fitnessBlue },
  { labelKey: 'fitness.fatAbbrev', value: '62', color: colors.fatiguePurple },
  { labelKey: 'fitness.formTSB', value: '+16', zoneColor: FORM_ZONE_COLORS.fresh },
];

const ZONE_BAR = [
  { zone: 'highRisk', flex: 1, color: FORM_ZONE_COLORS.highRisk },
  { zone: 'optimal', flex: 1, color: FORM_ZONE_COLORS.optimal },
  { zone: 'greyZone', flex: 1, color: FORM_ZONE_COLORS.greyZone },
  { zone: 'fresh', flex: 1, color: FORM_ZONE_COLORS.fresh },
  { zone: 'transition', flex: 1, color: FORM_ZONE_COLORS.transition },
];

export function FitnessHeroSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.heroRow}>
        {HERO_METRICS.map((metric) => {
          const valueColor = metric.zoneColor ?? metric.color;
          return (
            <View key={metric.labelKey} style={styles.heroCol}>
              <Text
                style={[
                  styles.heroLabel,
                  { color: isDark ? darkColors.textSecondary : colors.textSecondary },
                ]}
              >
                {t(metric.labelKey as never)}
              </Text>
              <Text style={[styles.heroValue, { color: valueColor }]}>{metric.value}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.zoneBarContainer}>
        <View style={styles.zoneBar}>
          {ZONE_BAR.map((zone) => (
            <View
              key={zone.zone}
              style={[styles.zoneSection, { flex: zone.flex, backgroundColor: zone.color }]}
            />
          ))}
        </View>
        <View style={styles.zoneLabels}>
          <Text
            style={[styles.zoneLabel, { color: isDark ? darkColors.textMuted : colors.textMuted }]}
          >
            {t('formZones.highRisk')}
          </Text>
          <Text
            style={[styles.zoneLabel, { color: isDark ? darkColors.textMuted : colors.textMuted }]}
          >
            {t('formZones.fresh')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  heroCol: {
    alignItems: 'center',
    gap: 4,
  },
  heroLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  heroValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  zoneBarContainer: {
    gap: 4,
  },
  zoneBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  zoneSection: {
    height: '100%',
  },
  zoneLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  zoneLabel: {
    fontSize: 11,
  },
});
