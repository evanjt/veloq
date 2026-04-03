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
import { SectionMapView, SectionTrimOverlay } from '@/components/routes';
import { formatDistance, type MaterialIconName } from '@/lib';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { RoutePoint, FrequentSection } from '@/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45);

export interface SectionHeaderProps {
  section: FrequentSection;
  isDark: boolean;
  insetTop: number;
  activityColor: string;
  iconName: MaterialIconName;
  activityCount: number;
  mapReady: boolean;
  isCustomId: boolean;
  isSectionDisabled: boolean;
  isEditing: boolean;
  editName: string;
  customName: string | null;
  nameInputRef: React.RefObject<TextInput | null>;
  canResetBounds: boolean;
  isTrimming: boolean;
  isExpandMode: boolean;
  trimStart: number;
  trimEnd: number;
  isTrimSaving: boolean;
  trimmedDistance: number;
  effectivePointCount: number;
  sectionStartInWindow?: number;
  sectionEndInWindow?: number;
  expandContextPoints?: RoutePoint[] | null;
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
    polylineCoords: number[];
  }>;
  onNearbyPress?: (sectionId: string) => void;
  onBack: () => void;
  onStartTrim: () => void;
  onDeleteSection: () => void;
  onToggleDisable: () => void;
  onStartEditing: () => void;
  onSaveName: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (text: string) => void;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  onConfirmTrim: () => void;
  onCancelTrim: () => void;
  onResetBounds: () => void;
  onToggleExpand: () => void;
  onRematchActivities?: () => void;
  isRematching?: boolean;
}

export function SectionHeader({
  section,
  isDark,
  insetTop,
  activityColor,
  iconName,
  activityCount,
  mapReady,
  isCustomId,
  isSectionDisabled,
  isEditing,
  editName,
  customName,
  nameInputRef,
  canResetBounds,
  isTrimming,
  isExpandMode,
  trimStart,
  trimEnd,
  isTrimSaving,
  trimmedDistance,
  effectivePointCount,
  sectionStartInWindow,
  sectionEndInWindow,
  expandContextPoints,
  shadowTrack,
  highlightedActivityId,
  highlightedLapPoints,
  allActivityTraces,
  isScrubbing,
  nearbyPolylines,
  onNearbyPress,
  onBack,
  onStartTrim,
  onDeleteSection,
  onToggleDisable,
  onStartEditing,
  onSaveName,
  onCancelEdit,
  onEditNameChange,
  onTrimStartChange,
  onTrimEndChange,
  onConfirmTrim,
  onCancelTrim,
  onResetBounds,
  onToggleExpand,
  onRematchActivities,
  isRematching,
}: SectionHeaderProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  return (
    <View style={styles.heroSection}>
      <View style={styles.mapContainer}>
        {mapReady ? (
          <SectionMapView
            section={section}
            height={MAP_HEIGHT}
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
          <View style={[styles.mapPlaceholder, { height: MAP_HEIGHT }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
        {isTrimming && (
          <SectionTrimOverlay
            pointCount={effectivePointCount || section.polyline?.length || 0}
            startIndex={trimStart}
            endIndex={trimEnd}
            trimmedDistance={trimmedDistance}
            originalDistance={section.distanceMeters}
            isSaving={isTrimSaving}
            canReset={canResetBounds}
            initiallyExpanded={!canResetBounds}
            isExpandMode={isExpandMode}
            sectionStartInWindow={sectionStartInWindow}
            sectionEndInWindow={sectionEndInWindow}
            onStartChange={onTrimStartChange}
            onEndChange={onTrimEndChange}
            onConfirm={onConfirmTrim}
            onCancel={onCancelTrim}
            onReset={onResetBounds}
            onToggleExpand={onToggleExpand}
          />
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

        {!isTrimming && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              testID="section-trim-button"
              style={styles.editBoundsPill}
              onPress={onStartTrim}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="content-cut"
                size={16}
                color="rgba(255, 255, 255, 0.9)"
              />
              <Text style={styles.editBoundsText}>{t('sections.editBounds')}</Text>
            </TouchableOpacity>
            {isCustomId ? (
              <TouchableOpacity
                style={styles.secondaryPill}
                onPress={onDeleteSection}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="delete-outline" size={16} color={colors.error} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.secondaryPill}
                onPress={onToggleDisable}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={isSectionDisabled ? 'undo' : 'delete-outline'}
                  size={16}
                  color={isSectionDisabled ? colors.success : 'rgba(255, 255, 255, 0.7)'}
                />
              </TouchableOpacity>
            )}
            {onRematchActivities && (
              <TouchableOpacity
                style={styles.secondaryPill}
                onPress={onRematchActivities}
                activeOpacity={0.7}
                disabled={isRematching}
              >
                <MaterialCommunityIcons
                  name={isRematching ? 'loading' : 'refresh'}
                  size={16}
                  color="rgba(255, 255, 255, 0.7)"
                />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroSection: {
    height: MAP_HEIGHT,
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  editBoundsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  editBoundsText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  secondaryPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
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
