/**
 * Section detail hero: DetailHero frame around SectionMapView with
 * editable name and traversal stats.
 */

import React from 'react';
import { View, StyleSheet, TextInput, Dimensions } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useMetricSystem } from '@/shared/app';
import { DetailHero, HeroNameRow, HeroStatsRow } from '@/shared/ui';
import { SectionMapView } from '../SectionMapView';
import { type MaterialIconName } from '@/features/activity/lib/activityUtils';
import { formatDistance } from '@/shared/format/format';
import { colors, darkColors } from '@/theme';
import type { RoutePoint, FrequentSection } from '@/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT_NORMAL = Math.round(SCREEN_HEIGHT * 0.42);
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
    <DetailHero
      height={mapHeight}
      insetTop={insetTop}
      onBack={onBack}
      overlay={
        <>
          <HeroNameRow
            name={customName ?? section.name ?? section.id}
            icon={{ name: iconName, color: activityColor }}
            editable={{
              isEditing,
              editName,
              inputRef: nameInputRef,
              placeholder: t('sections.sectionNamePlaceholder'),
              testIDPrefix: 'section',
              onStartEdit: onStartEditing,
              onSave: onSaveName,
              onCancel: onCancelEdit,
              onChange: onEditNameChange,
            }}
          />
          <HeroStatsRow
            stats={[
              formatDistance(section.distanceMeters, isMetric),
              `${activityCount} ${t('sections.traversals')}`,
            ]}
          />
        </>
      }
    >
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
    </DetailHero>
  );
}

const styles = StyleSheet.create({
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: darkColors.background,
  },
});
