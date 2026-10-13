import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  BodyNotDownloaded,
  EmptyState,
  ErrorState,
  ScreenSafeAreaView,
  ToggleButtonRow,
  Spinner,
  useScrollEndInset,
} from '@/shared/ui';
import type { Period } from '@/shared/app/period';
import { useActivityLabels } from '@/features/activity';
import {
  BEST_EFFORTS_SPORT,
  BEST_EFFORTS_PERIODS,
  bestEffortsDays,
  bestEffortsPeriodFromParam,
  bestEffortsOf,
  climbBestsOf,
  climbStatusOf,
  useBestEfforts,
  type BestEffort,
  type BestEffortsCurve,
  type ClimbBest,
  type ClimbStatus,
} from '@/features/stats';
import { useTheme } from '@/shared/app';
import { formatDurationOrNull } from '@/shared/format/format';
import {
  BestEffortRow,
  ClimbingBestRows,
  ClimbingStatusNote,
  formatEffortValue,
  SPORT_COLORS,
  SPORT_TEXT_COLORS,
  SPORT_TEXT_COLORS_DARK,
  type PrimarySport,
} from '@/features/fitness';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
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
  /** The curve behind the efforts, which says whether no values means none were fetched. */
  curve: BestEffortsCurve | undefined;
  isLoading: boolean;
  isDark: boolean;
}

function SportSection({ sport, efforts, curve, isLoading, isDark }: SportSectionProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  // The rows name at most fourteen activities, so they are read by id. The
  // curves are what decide which, and they are only known here.
  const effortIds = useMemo(
    () => efforts.map((e) => e.activityId).filter((id): id is string => !!id),
    [efforts]
  );
  const {
    labels: activityMap,
    error: labelsError,
    refetch: refetchLabels,
  } = useActivityLabels(effortIds);
  const sportColor = SPORT_COLORS[sport];
  const sportText = isDark ? SPORT_TEXT_COLORS_DARK[sport] : SPORT_TEXT_COLORS[sport];
  const hasAnyValue = efforts.some((e) => e.value !== null);
  const notFetched = curve !== undefined && !curve.fetched;

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
        <Text accessibilityRole="header" style={[styles.cardTitle, isDark && styles.cardTitleDark]}>
          {sectionTitle}
        </Text>
      </View>

      {labelsError != null && (
        <ErrorState
          variant="inline"
          error={labelsError}
          onRetry={refetchLabels}
          testID={`best-efforts-labels-failed-${sport}`}
        />
      )}

      {isLoading || (notFetched && curve.status === 'waiting') ? (
        <View style={styles.loadingContainer}>
          <Spinner />
        </View>
      ) : notFetched ? (
        <BodyNotDownloaded
          testID={`best-efforts-not-downloaded-${sport}`}
          style={styles.notDownloaded}
          textStyle={[styles.notDownloadedText, isDark && styles.notDownloadedTextDark]}
          message={t('statsScreen.curveNotDownloaded')}
          status={curve.status}
          onRetry={curve.retry}
        />
      ) : !hasAnyValue ? (
        <EmptyState variant="inline" title={t('statsScreen.noEffortData')} />
      ) : (
        efforts.map((effort, index) => {
          const activityInfo = effort.activityId ? activityMap.get(effort.activityId) : undefined;
          const timeStr = formatDurationOrNull(effort.time);
          const shownTime = timeStr && sport !== 'Cycling' ? timeStr : null;
          const valueText = formatEffortValue(effort.value, sport, t('units.watts'), isMetric);
          const isLast = index === efforts.length - 1;

          return (
            <BestEffortRow
              key={effort.checkpoint}
              testID={`best-efforts-row-${sport}-${effort.checkpoint}`}
              label={effort.label}
              value={valueText}
              secondary={shownTime}
              valueColor={sportText}
              isLast={isLast}
              activity={
                activityInfo && effort.activityId
                  ? { id: effort.activityId, ...activityInfo }
                  : undefined
              }
            >
              {effort.value !== null && labelsError == null ? (
                <Text style={[styles.activityMissing, isDark && styles.activityMissingDark]}>
                  {t('activitySummary.notDownloaded')}
                </Text>
              ) : null}
            </BestEffortRow>
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
        <Text accessibilityRole="header" style={[styles.cardTitle, isDark && styles.cardTitleDark]}>
          {t('bestEffortsScreen.climbingBests')}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <Spinner />
        </View>
      ) : !hasAnyValue && !hasNote ? (
        <EmptyState variant="inline" title={t('statsScreen.noEffortData')} />
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
  const scrollEndInset = useScrollEndInset({ insetTaken: true });
  // A link from a screen that showed a window opens on that window, so the
  // bests here answer the question the athlete tapped through with.
  const params = useLocalSearchParams<{ period?: string }>();
  const [period, setPeriod] = useState<Period>(() => bestEffortsPeriodFromParam(params.period));

  const days = bestEffortsDays(period);
  const { data, isLoading, error, refetch, curves } = useBestEfforts(days, SHOWN);
  const effortsBySport = useMemo(
    () => new Map(SPORTS.map((sport) => [sport, bestEffortsOf(data, sport, t)])),
    [data, t]
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

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: spacing.xl + scrollEndInset },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
          {period === 'all'
            ? t('bestEffortsScreen.allTimeSubtitle')
            : t('bestEffortsScreen.seasonSubtitle', { days })}
        </Text>

        {error != null ? (
          <ErrorState
            variant="inline"
            error={error}
            onRetry={() => void refetch()}
            testID="best-efforts-read-failed"
          />
        ) : (
          <>
            {SPORTS.map((sport) => (
              <SportSection
                key={sport}
                sport={sport}
                efforts={effortsBySport.get(sport) ?? []}
                curve={curves[BEST_EFFORTS_SPORT[sport]]}
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
          </>
        )}

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
  notDownloaded: {
    padding: spacing.md,
    alignItems: 'center',
  },
  notDownloadedText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  notDownloadedTextDark: {
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
