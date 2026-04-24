import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { useActivities, useSeasonBests, useTheme, type BestEffort } from '@/hooks';
import { formatDuration, formatLocalDate, formatPaceCompact, formatSwimPace } from '@/lib';
import { SPORT_COLORS, type PrimarySport } from '@/providers';
import { colors, darkColors, layout, spacing, typography, opacity } from '@/theme';

type TimeRangeKey = 'season' | 'allTime';

const SPORTS: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];
const SEASON_DAYS = 90;
const ALL_TIME_DAYS = 3650; // 10 years — matches SYNC.MAX_HISTORY_YEARS

function sportIcon(sport: PrimarySport): keyof typeof MaterialCommunityIcons.glyphMap {
  if (sport === 'Cycling') return 'bike';
  if (sport === 'Running') return 'run';
  return 'swim';
}

function formatEffortValue(effort: BestEffort, sport: PrimarySport): string {
  if (effort.value === null || !Number.isFinite(effort.value)) return '-';
  if (sport === 'Cycling') return `${Math.round(effort.value)}w`;
  if (sport === 'Running') return `${formatPaceCompact(effort.value)}/km`;
  return `${formatSwimPace(effort.value)}/100m`;
}

function formatEffortTime(effort: BestEffort): string | null {
  if (effort.time === null || !Number.isFinite(effort.time)) return null;
  return formatDuration(effort.time);
}

interface SportSectionProps {
  sport: PrimarySport;
  days: number;
  activityMap: Map<string, { name: string; date: string }>;
  isDark: boolean;
}

function SportSection({ sport, days, activityMap, isDark }: SportSectionProps) {
  const { t } = useTranslation();
  const { efforts, isLoading } = useSeasonBests({ sport, days });
  const sportColor = SPORT_COLORS[sport];
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
          const timeStr = formatEffortTime(effort);
          const isLast = index === efforts.length - 1;

          const rowBody = (
            <>
              <Text style={[styles.label, isDark && styles.labelDark]}>{effort.label}</Text>
              <View style={styles.valueColumn}>
                <Text style={[styles.value, { color: sportColor }]}>
                  {formatEffortValue(effort, sport)}
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

export default function BestEffortsScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [range, setRange] = useState<TimeRangeKey>('season');

  const days = range === 'season' ? SEASON_DAYS : ALL_TIME_DAYS;

  // Fetch activities for the window so we can display names and dates for each PR row.
  // For all-time we fetch the same broad window; activities older than the window
  // will degrade gracefully (showing "not cached" instead of a missing row).
  const { data: activities } = useActivities({ days });

  const activityMap = useMemo(() => {
    const map = new Map<string, { name: string; date: string }>();
    if (!activities) return map;
    for (const a of activities) {
      const dateStr = a.start_date_local ? formatLocalDate(new Date(a.start_date_local)) : '';
      map.set(a.id, { name: a.name, date: dateStr });
    }
    return map;
  }, [activities]);

  return (
    <ScreenErrorBoundary screenName="BestEfforts">
      <ScreenSafeAreaView
        style={[styles.container, isDark && styles.containerDark]}
        testID="best-efforts-screen"
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
            testID="best-efforts-back"
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isDark ? darkColors.textPrimary : colors.textPrimary}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDark && styles.headerTitleDark]}>
            {t('bestEffortsScreen.title')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View
          style={[styles.rangeToggleContainer, isDark && styles.rangeToggleContainerDark]}
          testID="best-efforts-range-toggle"
        >
          {(['season', 'allTime'] as TimeRangeKey[]).map((key) => {
            const active = range === key;
            return (
              <TouchableOpacity
                key={key}
                testID={`best-efforts-range-${key}`}
                style={[styles.rangeButton, active && styles.rangeButtonActive]}
                onPress={() => setRange(key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.rangeButtonText,
                    isDark && styles.rangeButtonTextDark,
                    active && styles.rangeButtonTextActive,
                  ]}
                >
                  {key === 'season'
                    ? t('bestEffortsScreen.thisSeason')
                    : t('bestEffortsScreen.allTime')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
            {range === 'season'
              ? t('bestEffortsScreen.seasonSubtitle', { days: SEASON_DAYS })
              : t('bestEffortsScreen.allTimeSubtitle')}
          </Text>

          {SPORTS.map((sport) => (
            <SportSection
              key={sport}
              sport={sport}
              days={days}
              activityMap={activityMap}
              isDark={isDark}
            />
          ))}

          <Text style={[styles.footerNote, isDark && styles.footerNoteDark]}>
            {t('bestEffortsScreen.sourceNote')}
          </Text>
        </ScrollView>
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.md,
  },
  backButton: {
    padding: spacing.xs,
    marginLeft: -spacing.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerTitleDark: {
    color: darkColors.textPrimary,
  },
  headerSpacer: {
    width: 32,
  },
  rangeToggleContainer: {
    flexDirection: 'row',
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
    backgroundColor: opacity.overlay.light,
    borderRadius: layout.borderRadiusSm,
    padding: 4,
  },
  rangeToggleContainerDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  rangeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm - 2,
  },
  rangeButtonActive: {
    backgroundColor: colors.primary,
  },
  rangeButtonText: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  rangeButtonTextDark: {
    color: darkColors.textSecondary,
  },
  rangeButtonTextActive: {
    color: colors.textOnDark,
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
    paddingVertical: spacing.sm + 2,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
  },
  rowBorderDark: {
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
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
    marginTop: 1,
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
    marginTop: 1,
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
