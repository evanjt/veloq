/**
 * Sections list component.
 * Displays frequently-traveled road sections with activity trace overlays.
 */

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, FlatList, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { colors, spacing, layout } from '@/theme';
import { useFrequentSections } from '@/hooks/routes/useFrequentSections';
import { SectionRow, ActivityTrace } from './SectionRow';
import { getGpsTracks } from '@/lib/gpsStorage';
import { extractSectionOverlap, SectionOverlap } from '@/lib/sectionOverlap';
import type { FrequentSection, RoutePoint } from '@/types';

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

  // Track loaded activity traces for each section
  const [sectionTraces, setSectionTraces] = useState<SectionTracesMap>(new Map());
  const [loadingTraces, setLoadingTraces] = useState(false);

  // Collect all unique activity IDs from all sections
  const allActivityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of sections) {
      // Only load first 4 activities per section for preview
      for (const id of section.activityIds.slice(0, 4)) {
        ids.add(id);
      }
    }
    return Array.from(ids);
  }, [sections]);

  // Load GPS tracks and compute overlaps
  useEffect(() => {
    if (sections.length === 0 || allActivityIds.length === 0) {
      setSectionTraces(new Map());
      return;
    }

    let cancelled = false;

    async function loadTraces() {
      setLoadingTraces(true);

      try {
        // Batch load all GPS tracks we need
        const gpsTracks = await getGpsTracks(allActivityIds);

        if (cancelled) return;

        // Compute overlaps for each section
        const tracesMap = new Map<string, ActivityTrace[]>();

        for (const section of sections) {
          if (!section.polyline || section.polyline.length < 2) {
            continue;
          }

          const traces: ActivityTrace[] = [];

          // Get overlaps for first 4 activities
          for (const activityId of section.activityIds.slice(0, 4)) {
            const track = gpsTracks.get(activityId);
            if (!track || track.length < 3) continue;

            // Extract the portion that overlaps with this section
            const overlap = extractSectionOverlap(
              activityId,
              track,
              section.polyline as RoutePoint[]
            );

            if (overlap && overlap.overlapPoints.length > 2) {
              traces.push({
                activityId,
                points: overlap.overlapPoints,
              });
            }
          }

          if (traces.length > 0) {
            tracesMap.set(section.id, traces);
          }
        }

        if (!cancelled) {
          setSectionTraces(tracesMap);
        }
      } catch (error) {
        console.warn('Failed to load section traces:', error);
      } finally {
        if (!cancelled) {
          setLoadingTraces(false);
        }
      }
    }

    loadTraces();

    return () => {
      cancelled = true;
    };
  }, [sections, allActivityIds]);

  // Navigate to section detail page
  const handleSectionPress = useCallback((section: FrequentSection) => {
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
