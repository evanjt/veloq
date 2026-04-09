import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, SegmentedButtons } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMapPreferences } from '@/providers';
import { type MapStyleType } from '@/components/maps';
import { MapStylePreviewPicker } from './MapStylePreviewPicker';
import { clearTerrainPreviews } from '@/lib/storage/terrainPreviewCache';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { settingsStyles } from './settingsStyles';
import type { ActivityType, Terrain3DMode } from '@/types';

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
  { key: 'hiking', labelKey: 'filters.hiking', types: ['Hike'] },
  { key: 'walking', labelKey: 'filters.walking', types: ['Walk'] },
  {
    key: 'swimming',
    labelKey: 'filters.swimming',
    types: ['Swim', 'OpenWaterSwim'],
  },
  {
    key: 'snow',
    labelKey: 'filters.snowSports',
    types: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard', 'Snowshoe'],
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

interface MapsSectionProps {
  /** When true, skip section label and outer card (for embedding in a parent card) */
  embedded?: boolean;
}

export function MapsSection({ embedded }: MapsSectionProps = {}) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [showActivityStyles, setShowActivityStyles] = useState(false);
  const {
    preferences: mapPreferences,
    setDefaultStyle,
    setActivityGroupStyle,
    setTerrain3DMode,
    setTerrain3DModeGroup,
    getTerrain3DMode,
  } = useMapPreferences();

  // Migrate stale per-type 3D overrides: old code only set types[0] per group.
  // Normalize so all types in a group share the same override.
  useEffect(() => {
    const byType = mapPreferences.terrain3DModeByType;
    for (const group of MAP_ACTIVITY_GROUPS) {
      const lead = byType[group.types[0]];
      if (lead === undefined) continue;
      const needsFix = group.types.some((t) => byType[t] !== lead);
      if (needsFix) {
        setTerrain3DModeGroup(group.types, lead);
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDefaultMapStyleChange = async (value: string) => {
    const style = value as MapStyleType;
    await setDefaultStyle(style);
    await clearTerrainPreviews();
  };

  const handleActivityGroupMapStyleChange = async (groupKey: string, value: string) => {
    const group = MAP_ACTIVITY_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;

    const style = value === 'default' ? null : (value as MapStyleType);
    await setActivityGroupStyle(group.types, style);
    await clearTerrainPreviews();
  };

  const handleTerrain3DModeChange = async (mode: string) => {
    await setTerrain3DMode(null, mode as Terrain3DMode);
    await clearTerrainPreviews();
  };

  const handleTerrain3DGroupModeChange = async (types: ActivityType[], mode: string) => {
    await setTerrain3DModeGroup(types, mode as Terrain3DMode);
    await clearTerrainPreviews();
  };

  // 3D terrain mode label
  const terrain3DLabel =
    mapPreferences.terrain3DMode === 'off'
      ? t('settings.terrain3DOff', { defaultValue: 'Off' })
      : mapPreferences.terrain3DMode === 'smart'
        ? t('settings.terrain3DSmart', { defaultValue: 'Smart' })
        : t('settings.terrain3DAlways', { defaultValue: 'Always' });

  const mapsContent = (
    <>
      {/* Default style + 3D terrain toggle in header row */}
      <View style={styles.styleHeaderRow}>
        <Text style={[styles.mapStyleLabel, isDark && settingsStyles.textLight]}>
          {t('settings.defaultStyle')}
        </Text>
        <TouchableOpacity
          style={styles.terrain3DBadge}
          onPress={() => {
            // Cycle: off → smart → always → off
            const modes: Terrain3DMode[] = ['off', 'smart', 'always'];
            const idx = modes.indexOf(mapPreferences.terrain3DMode);
            handleTerrain3DModeChange(modes[(idx + 1) % 3]);
          }}
          activeOpacity={0.6}
        >
          <MaterialCommunityIcons
            name="image-filter-hdr"
            size={14}
            color={mapPreferences.terrain3DMode === 'off' ? colors.textSecondary : colors.primary}
          />
          <Text
            style={[
              styles.terrain3DBadgeText,
              mapPreferences.terrain3DMode !== 'off' && styles.terrain3DBadgeActive,
            ]}
          >
            3D: {terrain3DLabel}
          </Text>
        </TouchableOpacity>
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
        <Text style={[styles.actionText, isDark && settingsStyles.textLight]}>
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
            const terrain3DModeForGroup = getTerrain3DMode(types[0]);
            return (
              <View key={key} style={styles.activityStyleRow}>
                <View style={styles.activityStyleHeader}>
                  <Text style={[styles.activityStyleLabel, isDark && settingsStyles.textLight]}>
                    {t(labelKey)}
                  </Text>
                </View>
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
                <View style={styles.terrain3DGroupRow}>
                  <Text style={[styles.terrain3DGroupLabel, isDark && settingsStyles.textMuted]}>
                    3D
                  </Text>
                  <SegmentedButtons
                    value={terrain3DModeForGroup}
                    onValueChange={(value) => handleTerrain3DGroupModeChange(types, value)}
                    buttons={[
                      {
                        value: 'off',
                        label: t('settings.terrain3DOff', { defaultValue: 'Off' }),
                      },
                      {
                        value: 'smart',
                        label: t('settings.terrain3DSmart', { defaultValue: 'Smart' }),
                      },
                      {
                        value: 'always',
                        label: t('settings.terrain3DAlways', { defaultValue: 'Always' }),
                      },
                    ]}
                    density="small"
                    style={styles.terrain3DGroupPicker}
                  />
                </View>
              </View>
            );
          })}
          <Text style={[styles.activityStyleHint, isDark && settingsStyles.textMuted]}>
            {t('settings.defaultMapHint')}
          </Text>
        </View>
      )}
    </>
  );

  if (embedded) {
    return mapsContent;
  }

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.maps').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {mapsContent}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  styleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  mapStyleLabel: {
    ...typography.bodySmall,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  terrain3DBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.light,
  },
  terrain3DBadgeText: {
    ...typography.badge,
    color: colors.textSecondary,
  },
  terrain3DBadgeActive: {
    color: colors.primary,
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
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },
  activityStylesContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  activityStyleRow: {
    marginTop: spacing.md,
  },
  activityStyleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  activityStyleLabel: {
    ...typography.bodySmall,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  activityStylePicker: {
    // Handled by React Native Paper
  },
  activityStyleHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  terrain3DGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  terrain3DGroupLabel: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  terrain3DGroupPicker: {
    flex: 1,
  },
});
