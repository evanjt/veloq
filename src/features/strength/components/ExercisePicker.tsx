import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import type { ExercisePickerRow } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { PressTarget } from '@/shared/ui/PressTarget';
import { SearchBar } from '@/shared/ui/SearchBar';
import { Icon } from '@/shared/ui/Icon';
import { bodyDiagram, colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';

import { useExercisePicker, type JustDone } from '../hooks/useExercisePicker';
import {
  EMPTY_PICKER_FILTER,
  clearBody,
  tapBody,
  toggleEquipment,
  type PickerFilterState,
} from '../lib/pickerFilter';
import { muscleName } from '../lib/muscleNames';
import { BodyPairWithLoupe } from './BodyPairWithLoupe';

const BODY_MAX_SCALE = 0.45;

interface ExercisePickerProps {
  gender: 'male' | 'female';
  /** The exercise just done in a session, whose usual followers lead the list. */
  after?: JustDone | null | undefined;
  /** One tap adds the exercise. */
  onPick: (row: ExercisePickerRow) => void;
}

/**
 * Chooses an exercise: equipment chips, the body pair (a first tap selects a region, a
 * second tap in it a muscle), a search field and the engine's list, the athlete's exercises
 * first with how long ago each was done.
 */
export function ExercisePicker({ gender, after = null, onPick }: ExercisePickerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const roles = bodyDiagram[isDark ? 'dark' : 'light'];
  const [filter, setFilter] = useState<PickerFilterState>(EMPTY_PICKER_FILTER);
  const data = useExercisePicker(filter, after);

  const tappable = useMemo(() => new Set(data.muscles.map((m) => m.slug)), [data.muscles]);
  const bodyData = useMemo<ExtendedBodyPart[]>(
    () =>
      data.muscles
        .filter((m) => m.region === filter.region)
        .map((m) => ({ slug: m.slug as NonNullable<ExtendedBodyPart['slug']>, intensity: 1 })),
    [data.muscles, filter.region]
  );

  const onMuscleTap = useCallback(
    (slug: string) => setFilter((state) => tapBody(state, slug, data.muscles)),
    [data.muscles]
  );
  const regionName = filter.region
    ? t(`strength.picker.regions.${filter.region}` as ParseKeys)
    : '';
  const filterLine = filter.muscle ? `${regionName} › ${muscleName(filter.muscle, t)}` : regionName;

  return (
    <View style={styles.container}>
      <View style={styles.chips}>
        {data.equipment.map((slug) => {
          const on = filter.equipment.includes(slug);
          return (
            <PressTarget
              key={slug}
              testID={`picker-equipment-${slug}`}
              onPress={() => setFilter((state) => toggleEquipment(state, slug))}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.chip,
                { borderColor: palette.border },
                on && { backgroundColor: palette.fillNeutral },
              ]}
            >
              <Text style={[styles.chipText, { color: palette.textPrimary }]}>
                {t(`strength.picker.equipment.${slug}` as ParseKeys)}
              </Text>
            </PressTarget>
          );
        })}
      </View>

      <BodyPairWithLoupe
        data={bodyData}
        selectedSlug={filter.muscle}
        gender={gender}
        maxScale={BODY_MAX_SCALE}
        colors={roles.steps}
        onMuscleTap={onMuscleTap}
        tappableSlugs={tappable}
        accessibilityLabel={t('strength.picker.bodyHint')}
      />

      {filter.region ? (
        <PressTarget
          testID="picker-filter-line"
          onPress={() => setFilter(clearBody)}
          accessibilityRole="button"
          accessibilityLabel={t('strength.picker.clearFilter')}
          style={styles.filterLine}
        >
          <Text style={[styles.filterText, { color: palette.textPrimary }]}>{filterLine}</Text>
          <Icon name="close" size={iconSize.sm} color={palette.textSecondary} />
        </PressTarget>
      ) : (
        <Text style={[styles.hint, { color: palette.textSecondary }]}>
          {t('strength.picker.bodyHint')}
        </Text>
      )}

      <SearchBar
        testID="picker-search"
        value={filter.query}
        onChangeText={(query) => setFilter((state) => ({ ...state, query }))}
        placeholder={t('strength.picker.searchPlaceholder')}
        style={styles.search}
      />

      <FlatList
        data={data.rows}
        keyExtractor={(row) => `${row.category}-${row.name}`}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            {t('strength.picker.empty')}
          </Text>
        }
        renderItem={({ item }) => (
          <PressTarget
            testID={`picker-row-${item.labelKey}`}
            onPress={() => onPick(item)}
            accessibilityRole="button"
            style={styles.row}
          >
            <View style={styles.rowName}>
              <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>
                {item.displayName}
              </Text>
              {item.usuallyNext ? (
                <Text style={[styles.rowNote, { color: palette.textSecondary }]}>
                  {t('strength.picker.usuallyNext')}
                </Text>
              ) : null}
            </View>
            {item.lastDoneDays != null ? (
              <Text
                testID={`picker-last-done-${item.labelKey}`}
                style={[styles.rowNote, { color: palette.textSecondary }]}
              >
                {t('strength.picker.daysAgo', { count: item.lastDoneDays })}
              </Text>
            ) : null}
          </PressTarget>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chip: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: layout.borderRadiusMd,
  },
  chipText: { ...typography.bodyCompact },
  filterLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: layout.minTapTarget,
  },
  filterText: { ...typography.bodyCompactBold },
  hint: {
    ...typography.caption,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  search: { marginHorizontal: spacing.md, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.minTapTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rowName: { flex: 1, gap: spacing.xxs },
  rowTitle: { ...typography.bodyCompact },
  rowNote: { ...typography.caption },
});
