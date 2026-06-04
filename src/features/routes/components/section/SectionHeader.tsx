/**
 * Section detail hero header with map, floating header buttons,
 * section name editing, and stats overlay.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, Dimensions } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useMetricSystem } from '@/hooks';
import { SectionMapView } from '@/features/routes';
import { formatDistance, type MaterialIconName } from '@/lib';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { RoutePoint, FrequentSection } from '@/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT_NORMAL = Math.round(SCREEN_HEIGHT * 0.45);
const MAP_HEIGHT_EDIT = Math.round(SCREEN_HEIGHT * 0.6);
export { MAP_HEIGHT_NORMAL, MAP_HEIGHT_EDIT };

export interface SectionHeaderProps {
  section: FrequentSection;
  mapHeight?: number;
  isDark: boolean;
  insetTop: number;
  activityColor: string;
  iconName: MaterialIconName;
  activityCount: number;
  mapReady: boolean;
  isTrimming: boolean;
  isExpandMode: boolean;
  trimStart: number;
  trimEnd: number;
  expandContextPoints?: RoutePoint[] | null;
  isEditing: boolean;
  editName: string;
  customName: string | null;
  nameInputRef: React.RefObject<TextInput | null>;
  shadowTrack?: [number, number][];
  highlightedActivityId: string | null;
  highlightedLapPoints?: RoutePoint[];
  allActivityTraces?: Record<string, RoutePoint[]>;
  isScrubbing: boolean;
  nearbyPolylines?: Array<{
    id: string;
    name?: string;
    sportType: string;
    distanceMeters: number;
    visitCount: number;
    encodedPolyline: ArrayBuffer;
  }>;
  onNearbyPress?: (sectionId: string) => void;
  onBack: () => void;
  onStartEditing: () => void;
  onSaveName: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (text: string) => void;
}

export function SectionHeader({
  section,
  isDark,
  insetTop,
  activityColor,
  iconName,
  activityCount,
  mapReady,
  mapHeight = MAP_HEIGHT_NORMAL,
  isTrimming,
  isExpandMode,
  trimStart,
  trimEnd,
  expandContextPoints,
  isEditing,
  editName,
  customName,
  nameInputRef,
  shadowTrack,
  highlightedActivityId,
  highlightedLapPoints,
  allActivityTraces,
  isScrubbing,
  nearbyPolylines,
  onNearbyPress,
  onBack,
  onStartEditing,
  onSaveName,
  onCancelEdit,
  onEditNameChange,
}: SectionHeaderProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  return (
    <View style={[styles.heroSection, { height: mapHeight }]}>
      <View style={styles.mapContainer}>
        {mapReady ? (
          <SectionMapView
            section={section}
            height={mapHeight}
            interactive={true}
            enableFullscreen={!isTrimming}
            shadowTrack={shadowTrack}
            highlightedActivityId={highlightedActivityId}
            highlightedLapPoints={highlightedLapPoints}
            allActivityTraces={allActivityTraces}
            isScrubbing={isScrubbing}
            trimRange={isTrimming ? { start: trimStart, end: trimEnd } : null}
            extensionTrack={isTrimming && isExpandMode ? expandContextPoints : null}
            nearbyPolylines={nearbyPolylines}
            onNearbyPress={onNearbyPress}
          />
        ) : (
          <View style={[styles.mapPlaceholder, { height: mapHeight }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
      </View>

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.7)']}
        style={styles.mapGradient}
        pointerEvents="none"
      />

      <View style={[styles.floatingHeader, { paddingTop: insetTop }]}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.infoOverlay}>
        <View style={styles.sectionNameRow}>
          <View style={[styles.typeIcon, { backgroundColor: activityColor }]}>
            <MaterialCommunityIcons name={iconName} size={16} color={colors.textOnDark} />
          </View>
          {isEditing ? (
            <View style={styles.editNameContainer}>
              <TextInput
                testID="section-rename-input"
                ref={nameInputRef}
                style={styles.editNameInput}
                value={editName}
                onChangeText={onEditNameChange}
                onSubmitEditing={onSaveName}
                placeholder={t('sections.sectionNamePlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.5)"
                returnKeyType="done"
                autoFocus
                selectTextOnFocus
              />
              <TouchableOpacity
                testID="section-rename-save"
                onPress={onSaveName}
                style={styles.editNameButton}
              >
                <MaterialCommunityIcons name="check" size={20} color={colors.success} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onCancelEdit} style={styles.editNameButton}>
                <MaterialCommunityIcons name="close" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              testID="section-rename-button"
              onPress={onStartEditing}
              style={styles.nameEditTouchable}
              activeOpacity={0.7}
            >
              <Text style={styles.heroSectionName} numberOfLines={1}>
                {customName ?? section.name ?? section.id}
              </Text>
              <MaterialCommunityIcons
                name="pencil"
                size={14}
                color="rgba(255,255,255,0.6)"
                style={styles.editIcon}
              />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.heroStatsRow}>
          <Text style={styles.heroStat}>{formatDistance(section.distanceMeters, isMetric)}</Text>
          <Text style={styles.heroStatDivider}>&middot;</Text>
          <Text style={styles.heroStat}>
            {activityCount} {t('sections.traversals')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroSection: {
    position: 'relative',
  },
  mapContainer: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: darkColors.background,
  },
  mapGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  sectionNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroSectionName: {
    flex: 1,
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  nameEditTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  editIcon: {
    marginLeft: 4,
  },
  editNameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  editNameInput: {
    flex: 1,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
    paddingVertical: spacing.sm,
  },
  editNameButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  heroStat: {
    fontSize: typography.bodySmall.fontSize,
    color: 'rgba(255, 255, 255, 0.9)',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  heroStatDivider: {
    fontSize: typography.bodySmall.fontSize,
    color: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: spacing.xs,
  },
});
