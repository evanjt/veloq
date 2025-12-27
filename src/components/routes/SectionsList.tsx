/**
 * Sections list component.
 * Displays frequently-traveled road sections.
 */

import React from 'react';
import { View, StyleSheet, FlatList, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, layout } from '@/theme';
import { useFrequentSections } from '@/hooks/routes/useFrequentSections';
import { SectionRow } from './SectionRow';

interface SectionsListProps {
  /** Filter by sport type */
  sportType?: string;
}

export function SectionsList({ sportType }: SectionsListProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { sections, totalCount, isReady } = useFrequentSections({
    sportType,
    minVisits: 3,
    sortBy: 'visits',
  });

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
            color={isDark ? '#444' : '#CCC'}
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
          color={isDark ? '#444' : '#CCC'}
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
          color={isDark ? '#666' : '#999'}
        />
        <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
          {t('routes.frequentSectionsInfo')}
        </Text>
      </View>
    </View>
  );

  return (
    <FlatList
      data={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <SectionRow section={item} />
      )}
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
