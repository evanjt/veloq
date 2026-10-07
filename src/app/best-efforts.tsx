import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  EngineReadFailure,
  ScreenSafeAreaView,
  TAB_BAR_SAFE_PADDING,
  ToggleButtonRow,
} from '@/shared/ui';
import type { Period } from '@/shared/app/period';
import { useActivityLabels } from '@/features/activity';
import {
  BEST_EFFORTS_DEFAULT_PERIOD,
  BEST_EFFORTS_PERIODS,
  bestEffortsDays,
  bestEffortsOf,
  climbBestsOf,
  climbStatusOf,
  useBestEfforts,
  type BestEffort,
  type ClimbBest,
  type ClimbStatus,
} from '@/features/stats';
import { useTheme } from '@/shared/app';
import { formatDurationOrNull } from '@/shared/format/format';
import {
  ClimbingBestRows,
  ClimbingStatusNote,
  formatEffortValue,
  SPORT_COLORS,
  SPORT_TEXT_COLORS,
  SPORT_TEXT_COLORS_DARK,
  type PrimarySport,
} from '@/features/fitness';
import { colors, darkColors, layout, spacing, typography, colorWithOpacity, ink } from '@/theme';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const SPORTS: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];
const CLIMBING_SPORTS: PrimarySport[] = ['Cycling', 'Running'];
const SHOWN = ['Ride', 'Run', 'Swim'] as const;

function sportIcon(sport: PrimarySport): keyof typeof MaterialCommunityIcons.glyphMap {
  if (sport === 'Cycling') return 'bike';
  if (sport === 'Running') return 'run';
  return 'swim';
}

interface SportSectionProps {
  sport: PrimarySport;
  efforts: BestEffort[];
  isLoading: boolean;
  isDark: boolean;
}

function SportSection({ sport, efforts, isLoading, isDark }: SportSectionProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  // The rows name at most fourteen activities, so they are read by id. The
  // curves are what decide which, and they are only known here.
  const effortIds = useMemo(
    () => efforts.map((e) => e.activityId).filter((id): id is string => !!id),
    [efforts]
  );
  const { labels: activityMap, error: labelsError } = useActivityLabels(effortIds);
  const sportColor = SPORT_COLORS[sport];
  const sportText = isDark ? SPORT_TEXT_COLORS_DARK[sport] : SPORT_TEXT_COLORS[sport];
  const hasAnyValue = efforts.some((e) => e.value !== null);

  const sectionTitle =
    sport === 'Cycling'
      ? t('bestEffortsScreen.powerBests')
      : sport === 'Running'
        ? t('bestEffortsScreen.paceBests')
        : t('bestEffortsScreen.swimBests');

  return (
    <View style={[styles.card, isDark && styles.cardDark]} testID={`best-efforts-section-${sport}`}>
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons
          name={sportIcon(sport)}
          size={18}
          color={sportColor}
          style={styles.cardHeaderIcon}
        />
        <Text style={[styles.cardTitle, isDark && styles.cardTitleDark]}>{sectionTitle}</Text>
      </View>

      {labelsError != null && (
        <EngineReadFailure error={labelsError} testID={`best-efforts-labels-failed-${sport}`} />
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : !hasAnyValue ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
            {t('statsScreen.noEffortData')}
          </Text>
        </View>
      ) : (
        efforts.map((effort, index) => {
          const activityInfo = effort.activityId ? activityMap.get(effort.activityId) : undefined;
          const timeStr = formatDurationOrNull(effort.time);
          const isLast = index === efforts.length - 1;

          const rowBody = (
            <>
              <Text style={[styles.label, isDark && styles.labelDark]}>{effort.label}</Text>
              <View style={styles.valueColumn}>
                <Text style={[styles.value, { color: sportText }]}>
                  {formatEffortValue(effort.value, sport, t('units.watts'), isMetric)}
                </Text>
                {timeStr && sport !== 'Cycling' ? (
                  <Text style={[styles.timeText, isDark && styles.timeTextDark]}>{timeStr}</Text>
                ) : null}
              </View>
              <View style={styles.activityColumn}>
                {activityInfo ? (
                  <>
                    <Text
                      style={[styles.activityName, isDark && styles.activityNameDark]}
                      numberOfLines={1}
                    >
                      {activityInfo.name}
                    </Text>
                    <Text style={[styles.activityDate, isDark && styles.activityDateDark]}>
                      {activityInfo.date}
                    </Text>
                  </>
                ) : effort.value !== null ? (
                  <Text style={[styles.activityMissing, isDark && styles.activityMissingDark]}>
                    {t('bestEffortsScreen.activityNotCached')}
                  </Text>
                ) : null}
              </View>
              {activityInfo ? (
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
              ) : null}
            </>
          );

          if (activityInfo && effort.activityId) {
            return (
              <TouchableOpacity
                key={effort.label}
                testID={`best-efforts-row-${sport}-${effort.label}`}
                style={[
                  styles.row,
                  !isLast && styles.rowBorder,
                  !isLast && isDark && styles.rowBorderDark,
                ]}
                activeOpacity={0.7}
                onPress={() => router.push(`/activity/${effort.activityId}`)}
              >
                {rowBody}
              </TouchableOpacity>
            );
          }

          return (
            <View
              key={effort.label}
              style={[
                styles.row,
                !isLast && styles.rowBorder,
                !isLast && isDark && styles.rowBorderDark,
              ]}
            >
              {rowBody}
            </View>
          );
        })
      )}
    </View>
  );
}

interface ClimbingSectionProps {
  sport: PrimarySport;
  bests: ClimbBest[];
  status: ClimbStatus;
  isLoading: boolean;
  isDark: boolean;
}

function ClimbingSection({ sport, bests, status, isLoading, isDark }: ClimbingSectionProps) {
  const { t } = useTranslation();
  const hasAnyValue = bests.some((b) => b.vam !== null || b.wattsPerKg !== null);
  const hasNote = status.owed > 0 || status.sourceExcluded > 0;

  return (
    <View
      style={[styles.card, isDark && styles.cardDark]}
      testID={`best-efforts-climbing-${sport}`}
    >
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons
          name={sportIcon(sport)}
          size={18}
          color={SPORT_COLORS[sport]}
          style={styles.cardHeaderIcon}
        />
        <Text style={[styles.cardTitle, isDark && styles.cardTitleDark]}>
          {t('bestEffortsScreen.climbingBests')}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : !hasAnyValue && !hasNote ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
            {t('statsScreen.noEffortData')}
          </Text>
        </View>
      ) : (
        <>
          {hasAnyValue ? <ClimbingBestRows bests={bests} sport={sport} /> : null}
          <ClimbingStatusNote status={status} />
        </>
      )}
    </View>
  );
}

function BestEffortsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [period, setPeriod] = useState<Period>(BEST_EFFORTS_DEFAULT_PERIOD);

  const days = bestEffortsDays(period);
  const { data, isLoading, error } = useBestEfforts(days, SHOWN);
  const effortsBySport = useMemo(
    () => new Map(SPORTS.map((sport) => [sport, bestEffortsOf(data, sport)])),
    [data]
  );

  const climbingBySport = useMemo(
    () => new Map(CLIMBING_SPORTS.map((sport) => [sport, climbBestsOf(data, sport)])),
    [data]
  );

  const climbStatusBySport = useMemo(
    () => new Map(CLIMBING_SPORTS.map((sport) => [sport, climbStatusOf(data, sport)])),
    [data]
  );

  return (
    <ScreenSafeAreaView
      hasNativeHeader
      style={[styles.container, isDark && styles.containerDark]}
      testID="best-efforts-screen"
    >
      <View style={styles.rangeToggleContainer} testID="best-efforts-range-toggle">
        <ToggleButtonRow
          options={BEST_EFFORTS_PERIODS.map((option) => ({
            value: option.id,
            label: t(option.labelKey as never),
            testID: `best-efforts-range-${option.id}`,
          }))}
          value={period}
          onValueChange={setPeriod}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
          {period === 'all'
            ? t('bestEffortsScreen.allTimeSubtitle')
            : t('bestEffortsScreen.seasonSubtitle', { days })}
        </Text>

        {error != null && <EngineReadFailure error={error} testID="best-efforts-read-failed" />}

        {SPORTS.map((sport) => (
          <SportSection
            key={sport}
            sport={sport}
            efforts={effortsBySport.get(sport) ?? []}
            isLoading={isLoading}
            isDark={isDark}
          />
        ))}

        {CLIMBING_SPORTS.map((sport) => (
          <ClimbingSection
            key={sport}
            sport={sport}
            bests={climbingBySport.get(sport) ?? []}
            status={climbStatusBySport.get(sport) ?? { owed: 0, sourceExcluded: 0 }}
            isLoading={isLoading}
            isDark={isDark}
          />
        ))}

        <Text style={[styles.footerNote, isDark && styles.footerNoteDark]}>
          {t('bestEffortsScreen.sourceNote')}
        </Text>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  rangeToggleContainer: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  cardHeaderIcon: {
    marginRight: spacing.sm,
  },
  cardTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  cardTitleDark: {
    color: darkColors.textPrimary,
  },
  loadingContainer: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyContainer: {
    padding: spacing.md,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  emptyTextDark: {
    color: darkColors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorWithOpacity(ink.black, 0.08),
  },
  rowBorderDark: {
    borderBottomColor: colorWithOpacity(ink.white, 0.08),
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 48,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  valueColumn: {
    width: 100,
    alignItems: 'flex-end',
  },
  value: {
    ...typography.body,
    fontWeight: '700',
  },
  timeText: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  timeTextDark: {
    color: darkColors.textSecondary,
  },
  activityColumn: {
    flex: 1,
    marginLeft: spacing.md,
  },
  activityName: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  activityNameDark: {
    color: darkColors.textPrimary,
  },
  activityDate: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  activityDateDark: {
    color: darkColors.textSecondary,
  },
  activityMissing: {
    ...typography.micro,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  activityMissingDark: {
    color: darkColors.textSecondary,
  },
  footerNote: {
    ...typography.micro,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  footerNoteDark: {
    color: darkColors.textSecondary,
  },
});

export default withScreenBoundary(BestEffortsScreenContent, 'BestEfforts');
