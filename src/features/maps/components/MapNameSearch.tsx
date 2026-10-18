import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMetricSystem, useTheme } from '@/shared/app';
import { composeAccessibilityLabel, Row, SearchBar } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { formatDistance, formatShortDateWithYear } from '@/shared/format/format';
import { spokenDistance } from '@/shared/format/spoken';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import {
  getActivityCategory,
  sportFamilyLabel,
  sportMarkColour,
} from '@/shared/activity/sportCategories';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import type { ActivityBoundsItem } from '@/types';
import { NameText } from '@/shared/ui/NameText';

interface MapNameSearchProps {
  needle: string;
  onChangeNeedle: (text: string) => void;
  /** Matches to offer under the field. Empty hides the list. */
  results: ActivityBoundsItem[];
  /** Every match the filters let through, of which `results` is the head. */
  total: number;
  /** The names of the active filters that narrowed the matches, as their chips draw them. */
  filters: string[];
  onChoose: (activityId: string) => void;
}

/**
 * The shared search field over the map and the matches it finds, one tap each.
 * A count line says how many of the matches are listed and which filters
 * narrowed them, and each row carries sport, distance and date so two rides of
 * one name can be told apart.
 */
export function MapNameSearch({
  needle,
  onChangeNeedle,
  results,
  total,
  filters,
  onChoose,
}: MapNameSearchProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();

  const shownOfTotal = t('mapScreen.searchCount', { shown: results.length, total });
  const filteredBy =
    filters.length > 0 ? t('mapScreen.searchFilteredBy', { filters: filters.join(', ') }) : null;
  const countLine = filteredBy ? [shownOfTotal, filteredBy].join(' · ') : shownOfTotal;

  return (
    <View>
      {results.length > 0 && (
        <View style={[styles.results, isDark && styles.surfaceDark]} testID="map-search-results">
          <Text
            testID="map-search-count"
            style={[styles.count, isDark && styles.secondaryDark]}
            accessibilityRole="text"
          >
            {countLine}
          </Text>
          {results.map((a) => {
            const date = formatShortDateWithYear(new Date(a.date));
            const distance = formatDistance(a.distance, isMetric);
            const sport = t(sportFamilyLabel(getActivityCategory(a.type)));
            return (
              <Row
                key={a.id}
                testID={`map-search-result-${a.id}`}
                behaviour="act"
                accessibilityLabel={composeAccessibilityLabel(
                  a.name,
                  sport,
                  spokenDistance(a.distance, isMetric),
                  date
                )}
                onPress={() => onChoose(a.id)}
              >
                <Icon
                  testID={`map-search-result-${a.id}-icon`}
                  name={getActivityIcon(a.type)}
                  size={iconSize.md}
                  color={sportMarkColour(a.type, isDark)}
                />
                <NameText style={[styles.resultName, isDark && styles.textOnDark]}>
                  {a.name}
                </NameText>
                <Text style={[styles.resultDetail, isDark && styles.secondaryDark]}>
                  {distance}
                </Text>
                <Text style={[styles.resultDetail, isDark && styles.secondaryDark]}>{date}</Text>
              </Row>
            );
          })}
        </View>
      )}
      <SearchBar
        value={needle}
        onChangeText={onChangeNeedle}
        placeholder={t('feed.searchPlaceholder')}
        testID="map-search-input"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  surfaceDark: {
    backgroundColor: darkColors.surface,
  },
  textOnDark: {
    color: colors.textOnFill,
  },
  results: {
    marginBottom: spacing.sm,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colors.fillNeutral,
  },
  count: {
    ...typography.bodyCompact,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    color: colors.textSecondary,
  },
  resultName: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.textPrimary,
  },
  resultDetail: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  secondaryDark: {
    color: darkColors.textSecondary,
  },
});
