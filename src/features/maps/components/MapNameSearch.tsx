import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { pressable, pressRipple, SearchBar } from '@/shared/ui';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import type { ActivityBoundsItem } from '@/types';

interface MapNameSearchProps {
  needle: string;
  onChangeNeedle: (text: string) => void;
  /** Matches to offer under the field. Empty hides the list. */
  results: ActivityBoundsItem[];
  onChoose: (activityId: string) => void;
}

/** The shared search field over the map and the matches it finds, one tap each. */
export function MapNameSearch({ needle, onChangeNeedle, results, onChoose }: MapNameSearchProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <View>
      {results.length > 0 && (
        <View style={[styles.results, isDark && styles.surfaceDark]} testID="map-search-results">
          {results.map((a) => (
            <Pressable
              key={a.id}
              testID={`map-search-result-${a.id}`}
              accessibilityRole="button"
              accessibilityLabel={a.name}
              onPress={() => onChoose(a.id)}
              style={pressable(styles.resultRow)}
              android_ripple={pressRipple}
            >
              <Text numberOfLines={1} style={[styles.resultName, isDark && styles.textOnDark]}>
                {a.name}
              </Text>
              <Text style={[styles.resultDate, isDark && styles.resultDateDark]}>
                {a.date.slice(0, 10)}
              </Text>
            </Pressable>
          ))}
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
    color: colors.textOnDark,
  },
  results: {
    marginBottom: spacing.sm,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colors.gray100,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  resultName: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    color: colors.textPrimary,
  },
  resultDate: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  resultDateDark: {
    color: darkColors.textSecondary,
  },
});
