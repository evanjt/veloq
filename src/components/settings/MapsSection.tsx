import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, SegmentedButtons } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMapPreferences } from '@/providers';
import { type MapStyleType } from '@/components/maps';
import { MapStylePreviewPicker } from './MapStylePreviewPicker';
import { colors, darkColors, spacing, layout } from '@/theme';
import type { ActivityType } from '@/types';

type FilterLabelKey =
  | 'filters.cycling'
  | 'filters.running'
  | 'filters.hiking'
  | 'filters.walking'
  | 'filters.swimming'
  | 'filters.snowSports'
  | 'filters.waterSports'
  | 'filters.climbing'
  | 'filters.racketSports'
  | 'filters.other';

const MAP_ACTIVITY_GROUPS: {
  key: string;
  labelKey: FilterLabelKey;
  types: ActivityType[];
}[] = [
  {
    key: 'cycling',
    labelKey: 'filters.cycling',
    types: ['Ride', 'VirtualRide'],
  },
  {
    key: 'running',
    labelKey: 'filters.running',
    types: ['Run', 'TrailRun', 'VirtualRun'],
  },
  { key: 'hiking', labelKey: 'filters.hiking', types: ['Hike', 'Snowshoe'] },
  { key: 'walking', labelKey: 'filters.walking', types: ['Walk'] },
  {
    key: 'swimming',
    labelKey: 'filters.swimming',
    types: ['Swim', 'OpenWaterSwim'],
  },
  {
    key: 'snow',
    labelKey: 'filters.snowSports',
    types: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard'],
  },
  {
    key: 'water',
    labelKey: 'filters.waterSports',
    types: ['Rowing', 'Kayaking', 'Canoeing'],
  },
  { key: 'climbing', labelKey: 'filters.climbing', types: ['RockClimbing'] },
  { key: 'racket', labelKey: 'filters.racketSports', types: ['Tennis'] },
  {
    key: 'other',
    labelKey: 'filters.other',
    types: ['Workout', 'WeightTraining', 'Yoga', 'Other'],
  },
];

export function MapsSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [showActivityStyles, setShowActivityStyles] = useState(false);
  const {
    preferences: mapPreferences,
    setDefaultStyle,
    setActivityGroupStyle,
  } = useMapPreferences();

  const handleDefaultMapStyleChange = async (value: string) => {
    const style = value as MapStyleType;
    await setDefaultStyle(style);
  };

  const handleActivityGroupMapStyleChange = async (groupKey: string, value: string) => {
    const group = MAP_ACTIVITY_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;

    const style = value === 'default' ? null : (value as MapStyleType);
    await setActivityGroupStyle(group.types, style);
  };

  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.maps').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <View style={styles.mapStyleRow}>
          <Text style={[styles.mapStyleLabel, isDark && styles.textLight]}>
            {t('settings.defaultStyle')}
          </Text>
        </View>
        <MapStylePreviewPicker
          value={mapPreferences.defaultStyle}
          onValueChange={handleDefaultMapStyleChange}
        />

        {/* Per-activity-type styles toggle */}
        <TouchableOpacity
          style={[styles.actionRow, styles.actionRowBorder]}
          onPress={() => setShowActivityStyles(!showActivityStyles)}
        >
          <MaterialCommunityIcons name="tune-variant" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {t('settings.customiseByActivity')}
          </Text>
          <MaterialCommunityIcons
            name={showActivityStyles ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>

        {/* Per-activity-group pickers */}
        {showActivityStyles && (
          <View style={styles.activityStylesContainer}>
            {MAP_ACTIVITY_GROUPS.map(({ key, labelKey, types }) => {
              // Use the first type in the group to determine current style
              const currentStyle = mapPreferences.activityTypeStyles[types[0]] ?? 'default';
              return (
                <View key={key} style={styles.activityStyleRow}>
                  <Text style={[styles.activityStyleLabel, isDark && styles.textLight]}>
                    {t(labelKey)}
                  </Text>
                  <SegmentedButtons
                    value={currentStyle}
                    onValueChange={(value) => handleActivityGroupMapStyleChange(key, value)}
                    buttons={[
                      { value: 'default', label: t('settings.default') },
                      { value: 'light', label: t('settings.light') },
                      { value: 'dark', label: t('settings.dark') },
                      { value: 'satellite', label: t('settings.satellite') },
                    ]}
                    density="small"
                    style={styles.activityStylePicker}
                  />
                </View>
              );
            })}
            <Text style={[styles.activityStyleHint, isDark && styles.textMuted]}>
              {t('settings.defaultMapHint')}
            </Text>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  mapStyleRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  mapStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  activityStylesContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  activityStyleRow: {
    marginTop: spacing.md,
  },
  activityStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  activityStylePicker: {
    // Handled by React Native Paper
  },
  activityStyleHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
