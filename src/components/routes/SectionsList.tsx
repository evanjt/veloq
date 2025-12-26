/**
 * Sections list component.
 * Displays frequently-traveled road sections with activity trace overlays.
 *
 * Activity traces are pre-computed in Rust during section detection,
 * so no expensive on-the-fly computation is needed here.
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { colors, spacing, layout } from '@/theme';
import { useFrequentSections } from '@/hooks/routes/useFrequentSections';
import { SectionRow, ActivityTrace } from './SectionRow';
import type { FrequentSection } from '@/types';

interface SectionsListProps {
  /** Filter by sport type */
  sportType?: string;
}

/** Map of section ID to activity traces for that section */
type SectionTracesMap = Map<string, ActivityTrace[]>;

export function SectionsList({ sportType }: SectionsListProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { sections, totalCount, isReady } = useFrequentSections({
    sportType,
    minVisits: 3,
    sortBy: 'visits',
  });

  // Convert pre-computed activity traces from sections to the format expected by SectionRow
  // This is instant since traces are already computed by Rust during section detection
  const sectionTraces = useMemo((): SectionTracesMap => {
    const tracesMap = new Map<string, ActivityTrace[]>();

    for (const section of sections) {
      if (!section.activityTraces) continue;

      const traces: ActivityTrace[] = [];
      // Use first 4 activities for preview (same as before)
      const activityIds = section.activityIds.slice(0, 4);

      for (const activityId of activityIds) {
        const points = section.activityTraces[activityId];
        if (points && points.length > 2) {
          // Convert RoutePoint[] to [lat, lng][] format expected by SectionRow
          traces.push({
            activityId,
            points: points.map(p => [p.lat, p.lng] as [number, number]),
          });
        }
      }

      if (traces.length > 0) {
        tracesMap.set(section.id, traces);
      }
    }

    return tracesMap;
  }, [sections]);

  // Navigate to section detail page
  const handleSectionPress = useCallback((section: FrequentSection) => {
    console.log('[SectionsList] Section pressed:', section.id);
    router.push(`/section/${section.id}` as Href);
  }, []);

  const renderEmpty = () => {
    if (!isReady) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="loading"
            size={48}
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            Loading sections...
          </Text>
        </View>
      );
    }

    if (totalCount === 0) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="road-variant"
            size={48}
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            No frequent sections yet
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
            Sections are detected when you travel the same roads multiple times,
            even on different routes
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="filter-remove-outline"
          size={48}
          color={isDark ? '#444' : '#CCC'}
        />
        <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
          No sections match filter
        </Text>
        <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
          Try adjusting the sport type filter
        </Text>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={[styles.infoNotice, isDark && styles.infoNoticeDark]}>
        <MaterialCommunityIcons
          name="information-outline"
          size={14}
          color={isDark ? '#666' : '#999'}
        />
        <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
          Frequent sections are road segments you travel often, detected automatically from your GPS tracks.
        </Text>
      </View>
    </View>
  );

  const renderItem = useCallback(
    ({ item }: { item: FrequentSection }) => (
      <SectionRow
        section={item}
        activityTraces={sectionTraces.get(item.id)}
        onPress={() => handleSectionPress(item)}
      />
    ),
    [sectionTraces, handleSectionPress]
  );

  return (
    <FlatList
      data={sections}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={sections.length === 0 ? styles.emptyList : styles.list}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  emptyList: {
    flexGrow: 1,
    paddingTop: spacing.md,
  },
  header: {
    marginBottom: spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding * 2,
    paddingVertical: spacing.xxl * 2,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.lg,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
  infoNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
  },
  infoNoticeDark: {},
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#999',
    lineHeight: 16,
  },
  infoTextDark: {
    color: '#666',
  },
});
