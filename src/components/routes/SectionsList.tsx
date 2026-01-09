/**
 * Sections list component.
 * Displays unified sections (auto-detected + custom + potential).
 *
 * Activity traces are pre-computed in Rust during section detection,
 * so no expensive on-the-fly computation is needed here.
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, useColorScheme, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, Href } from 'expo-router';
import { colors, darkColors, spacing, layout } from '@/theme';
import { useUnifiedSections } from '@/hooks/routes/useUnifiedSections';
import { SectionRow, ActivityTrace } from './SectionRow';
import { PotentialSectionCard } from './PotentialSectionCard';
import { useCustomSections } from '@/hooks/routes/useCustomSections';
import { useSectionDismissals } from '@/providers/SectionDismissalsStore';
import { debug } from '@/lib';
import type { UnifiedSection, FrequentSection } from '@/types';

const log = debug.create('SectionsList');

interface SectionsListProps {
  /** Filter by sport type */
  sportType?: string;
}

/** Map of section ID to activity traces for that section */
type SectionTracesMap = Map<string, ActivityTrace[]>;

export function SectionsList({ sportType }: SectionsListProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const {
    sections: unifiedSections,
    count: totalCount,
    autoCount,
    customCount,
    potentialCount,
    isLoading,
  } = useUnifiedSections({
    sportType,
    includeCustom: true,
    includePotentials: true,
  });

  const { createSection } = useCustomSections();

  // Separate regular sections from potential sections
  const { regularSections, potentialSections } = useMemo(() => {
    const regular: UnifiedSection[] = [];
    const potential: UnifiedSection[] = [];

    for (const section of unifiedSections) {
      if (section.source === 'potential') {
        potential.push(section);
      } else {
        regular.push(section);
      }
    }

    return { regularSections: regular, potentialSections: potential };
  }, [unifiedSections]);

  const isReady = !isLoading;

  // Convert pre-computed activity traces from sections to the format expected by SectionRow
  // This is instant since traces are already computed by Rust during section detection
  const sectionTraces = useMemo((): SectionTracesMap => {
    const tracesMap = new Map<string, ActivityTrace[]>();

    for (const section of regularSections) {
      // Get activityTraces from engineData if available
      const engineData = section.engineData;
      if (!engineData?.activityTraces) continue;

      const traces: ActivityTrace[] = [];
      // Use first 4 activities for preview
      const activityIds = engineData.activityIds.slice(0, 4);

      for (const activityId of activityIds) {
        const points = engineData.activityTraces[activityId];
        if (points && points.length > 2) {
          // Convert RoutePoint[] to [lat, lng][] format expected by SectionRow
          traces.push({
            activityId,
            points: points.map((p) => [p.lat, p.lng] as [number, number]),
          });
        }
      }

      if (traces.length > 0) {
        tracesMap.set(section.id, traces);
      }
    }

    return tracesMap;
  }, [regularSections]);

  // Navigate to section detail page
  const handleSectionPress = useCallback((section: UnifiedSection) => {
    log.log('Section pressed:', section.id);
    router.push(`/section/${section.id}` as Href);
  }, []);

  // Handle promoting a potential section to a custom section
  const handlePromotePotential = useCallback(
    async (section: UnifiedSection) => {
      if (!section.potentialData) return;
      log.log('Promoting potential section:', section.id);
      try {
        await createSection({
          polyline: section.polyline,
          startIndex: 0,
          endIndex: section.polyline.length - 1,
          sourceActivityId: section.potentialData.activityIds[0] ?? 'unknown',
          sportType: section.sportType,
          distanceMeters: section.distanceMeters,
        });
      } catch (error) {
        log.error('Failed to promote section:', error);
      }
    },
    [createSection]
  );

  // Handle dismissing a potential section
  const dismiss = useSectionDismissals((s) => s.dismiss);
  const handleDismissPotential = useCallback(
    async (section: UnifiedSection) => {
      log.log('Dismissing potential section:', section.id);
      await dismiss(section.id);
    },
    [dismiss]
  );

  const renderEmpty = () => {
    if (!isReady) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="loading"
            size={48}
            color={isDark ? darkColors.iconDisabled : colors.gray400}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            {t('routes.loadingSections')}
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
            color={isDark ? darkColors.iconDisabled : colors.gray400}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            {t('routes.noFrequentSections')}
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
            {t('routes.sectionsDescription')}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="filter-remove-outline"
          size={48}
          color={isDark ? darkColors.iconDisabled : colors.gray400}
        />
        <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
          {t('routes.noSectionsMatchFilter')}
        </Text>
        <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
          {t('routes.adjustSportTypeFilter')}
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
          color={isDark ? darkColors.textDisabled : colors.textDisabled}
        />
        <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
          {t('routes.frequentSectionsInfo')}
        </Text>
      </View>

      {/* Section type counts */}
      {(customCount > 0 || autoCount > 0) && (
        <View style={styles.sectionCounts}>
          {customCount > 0 && (
            <View style={[styles.countBadge, styles.customBadge]}>
              <MaterialCommunityIcons name="account" size={12} color={colors.primary} />
              <Text style={[styles.countText, { color: colors.primary }]}>
                {customCount} {t('routes.custom')}
              </Text>
            </View>
          )}
          {autoCount > 0 && (
            <View style={[styles.countBadge, styles.autoBadge]}>
              <MaterialCommunityIcons name="auto-fix" size={12} color={colors.success} />
              <Text style={[styles.countText, { color: colors.success }]}>
                {autoCount} {t('routes.autoDetected')}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Potential section suggestions */}
      {potentialSections.length > 0 && (
        <View style={styles.suggestionsContainer}>
          <Text style={[styles.suggestionsTitle, isDark && styles.textLight]}>
            {t('routes.suggestions' as never)}
          </Text>
          {potentialSections.slice(0, 3).map((section) => (
            <PotentialSectionCard
              key={section.id}
              section={section.potentialData!}
              onPromote={() => handlePromotePotential(section)}
              onDismiss={() => handleDismissPotential(section)}
            />
          ))}
        </View>
      )}
    </View>
  );

  // Convert UnifiedSection to FrequentSection-like object for SectionRow
  const toFrequentSection = useCallback((section: UnifiedSection): FrequentSection => {
    // If we have engineData, use it directly
    if (section.engineData) {
      return section.engineData;
    }
    // Otherwise, construct a compatible object
    return {
      id: section.id,
      sportType: section.sportType,
      polyline: section.polyline,
      activityIds: section.customData?.matches.map((m) => m.activityId) ?? [],
      routeIds: [],
      visitCount: section.visitCount,
      distanceMeters: section.distanceMeters,
      name: section.name,
    };
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: UnifiedSection }) => {
      const frequentSection = toFrequentSection(item);
      return (
        <View>
          <SectionRow
            section={frequentSection}
            activityTraces={sectionTraces.get(item.id)}
            onPress={() => handleSectionPress(item)}
          />
          {/* Show source badge for custom sections */}
          {item.source === 'custom' && (
            <View style={styles.sourceBadge}>
              <Text style={styles.sourceBadgeText}>{t('routes.custom')}</Text>
            </View>
          )}
        </View>
      );
    },
    [sectionTraces, handleSectionPress, toFrequentSection, t]
  );

  return (
    <FlatList
      data={regularSections}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={regularSections.length === 0 ? styles.emptyList : styles.list}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // Performance optimizations
      removeClippedSubviews={Platform.OS === 'ios'}
      maxToRenderPerBatch={10}
      windowSize={5}
      initialNumToRender={8}
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
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textMuted,
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
    color: colors.textDisabled,
    lineHeight: 16,
  },
  infoTextDark: {
    color: darkColors.textDisabled,
  },
  sectionCounts: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius / 2,
  },
  customBadge: {
    backgroundColor: colors.primary + '20',
  },
  autoBadge: {
    backgroundColor: colors.success + '20',
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
  },
  suggestionsContainer: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  suggestionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sourceBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.md + spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textOnDark,
  },
});
