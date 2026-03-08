import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Share, Platform } from 'react-native';
import { Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useTheme } from '@/hooks';
import { useMapPreferences } from '@/providers';
import { getActivityIcon } from '@/lib';
import { colors, darkColors, spacing, brand } from '@/theme';
import type { Activity } from '@/types';
import type { MapStyleType } from '@/components/maps/mapStyles';

interface ActivityCardContextMenuProps {
  visible: boolean;
  onDismiss: () => void;
  activity: Activity;
}

const MAP_STYLES: {
  key: MapStyleType;
  icon: string;
  bg: string;
  labelKey: 'settings.light' | 'settings.dark' | 'settings.satellite';
}[] = [
  { key: 'light', icon: 'white-balance-sunny', bg: '#E5E7EB', labelKey: 'settings.light' },
  { key: 'dark', icon: 'weather-night', bg: '#374151', labelKey: 'settings.dark' },
  { key: 'satellite', icon: 'satellite-variant', bg: '#1E6B5A', labelKey: 'settings.satellite' },
];

export function ActivityCardContextMenu({
  visible,
  onDismiss,
  activity,
}: ActivityCardContextMenuProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const {
    getStyleForActivity,
    getTerrain3DMode,
    setActivityOverride,
    clearActivityOverride,
    hasActivityOverride,
  } = useMapPreferences();

  const currentStyle = getStyleForActivity(activity.type, activity.id);
  const currentTerrain = getTerrain3DMode(activity.type, activity.id);
  const is3DOn = currentTerrain === 'always';
  const hasOverride = hasActivityOverride(activity.id);

  const handleStyleSelect = useCallback(
    (style: MapStyleType) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActivityOverride(activity.id, { style });
    },
    [activity.id, setActivityOverride]
  );

  const handleToggle3D = useCallback(
    (value: boolean) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActivityOverride(activity.id, { terrain3D: value });
    },
    [activity.id, setActivityOverride]
  );

  const handleReset = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearActivityOverride(activity.id);
  }, [activity.id, clearActivityOverride]);

  const handleShare = useCallback(async () => {
    onDismiss();
    const url = `https://intervals.icu/activities/${activity.id}`;
    try {
      await Share.share({
        message: Platform.OS === 'ios' ? activity.name : `${activity.name}\n${url}`,
        url: Platform.OS === 'ios' ? url : undefined,
        title: activity.name,
      });
    } catch {
      // User cancelled or error
    }
  }, [activity.id, activity.name, onDismiss]);

  const handleViewDetails = useCallback(() => {
    onDismiss();
    router.push(`/activity/${activity.id}`);
  }, [activity.id, onDismiss]);

  const iconName = getActivityIcon(activity.type);
  const bgColor = isDark ? darkColors.surfaceElevated : colors.surface;
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const dividerColor = isDark ? darkColors.border : 'rgba(0,0,0,0.08)';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable style={[styles.card, { backgroundColor: bgColor }]} onPress={() => {}}>
          {/* Header */}
          <View style={styles.header}>
            <MaterialCommunityIcons name={iconName} size={18} color={mutedColor} />
            <Text style={[styles.title, { color: textColor }]} numberOfLines={1}>
              {activity.name}
            </Text>
            <Pressable onPress={onDismiss} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color={mutedColor} />
            </Pressable>
          </View>

          {/* Map Style Selector */}
          <View style={styles.styleSection}>
            <Text style={[styles.sectionLabel, { color: mutedColor }]}>
              {t('activity.mapStyle')}
            </Text>
            <View style={styles.styleRow}>
              {MAP_STYLES.map(({ key, icon, bg, labelKey }) => {
                const isSelected = currentStyle === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => handleStyleSelect(key)}
                    style={styles.styleOption}
                  >
                    <View
                      style={[
                        styles.styleCircle,
                        { backgroundColor: bg },
                        isSelected && styles.styleCircleSelected,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
                        size={22}
                        color={key === 'light' ? '#6B7280' : '#FFFFFF'}
                      />
                    </View>
                    <Text
                      style={[
                        styles.styleLabel,
                        { color: isSelected ? textColor : mutedColor },
                        isSelected && styles.styleLabelSelected,
                      ]}
                    >
                      {t(labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 3D Toggle */}
          <View style={[styles.toggleRow, { borderColor: dividerColor }]}>
            <Text style={[styles.toggleLabel, { color: textColor }]}>3D</Text>
            <Switch value={is3DOn} onValueChange={handleToggle3D} color={brand.teal} />
          </View>

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: dividerColor }]} />

          {/* Actions */}
          <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
            onPress={handleShare}
          >
            <MaterialCommunityIcons name="share-variant" size={20} color={mutedColor} />
            <Text style={[styles.actionText, { color: textColor }]}>{t('activity.share')}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
            onPress={handleViewDetails}
          >
            <MaterialCommunityIcons name="information-outline" size={20} color={mutedColor} />
            <Text style={[styles.actionText, { color: textColor }]}>
              {t('activity.viewDetails')}
            </Text>
          </Pressable>

          {/* Reset to Default */}
          {hasOverride && (
            <>
              <View style={[styles.divider, { backgroundColor: dividerColor }]} />
              <Pressable
                style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
                onPress={handleReset}
              >
                <MaterialCommunityIcons name="undo" size={20} color={mutedColor} />
                <Text style={[styles.actionText, { color: mutedColor }]}>
                  {t('activity.resetToDefault')}
                </Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: 300,
    borderRadius: 16,
    paddingVertical: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  styleSection: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  styleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  styleOption: {
    alignItems: 'center',
    gap: 6,
  },
  styleCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  styleCircleSelected: {
    borderColor: brand.teal,
  },
  styleLabel: {
    fontSize: 12,
    fontWeight: '400',
  },
  styleLabelSelected: {
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 12,
  },
  actionRowPressed: {
    opacity: 0.6,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '400',
  },
});
