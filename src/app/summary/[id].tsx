/**
 * What one activity was worth, on a screen.
 *
 * The enriched notification walks a priority ladder over engine data and turns
 * it into one sentence. Until this screen that sentence existed nowhere else,
 * so an athlete who read it on the lock screen could not check it against
 * anything: the tap landed on the detail screen, whose first paint is two
 * chart skeletons behind a deferred engine batch, and whose numbers are a
 * different set entirely.
 *
 * This is the notification's own claim, whole, with the figures behind it and
 * a way through to the detail. It is a route rather than a fifth tab because
 * the tabs there render after that deferred batch and a summary has to paint
 * at once, and because `tab` is already a deep-link parameter on that screen.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useActivity } from '@/features/activity';
import { useActivityHighlight, type ActivityInfo } from '@/features/insights';
import { useMetricSystem, useTheme } from '@/shared/app';
import { formatDistance, formatDuration } from '@/shared/format/format';
import { Button, ScreenErrorBoundary, ScreenSafeAreaView } from '@/shared/ui';
import { createSharedStyles } from '@/styles';
import { colors, spacing, typography } from '@/theme';

/** The glyph for each rung, so the verdict reads before the sentence does. */
const TIER_ICONS = {
  pr: 'trophy',
  faster: 'trending-up',
  recorded: 'check-circle-outline',
} as const;

export default function ActivitySummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const isMetric = useMetricSystem();

  const { data: activity, isLoading } = useActivity(id ?? '');

  const info: ActivityInfo | null = useMemo(
    () =>
      activity
        ? {
            name: activity.name,
            type: activity.type,
            ingested: true,
            distance: activity.distance,
            movingTime: activity.moving_time,
          }
        : null,
    [activity]
  );

  const highlight = useActivityHighlight(activity ? id : undefined, info);

  // A push can land before its activity has reached the local database.
  // `useActivity` asks the engine for the detail and re-resolves, so this is a
  // real wait with an end, and it must not read as the same blank skeleton the
  // detail screen shows while it reads a row it already holds.
  const awaitingActivity = !isLoading && !activity;

  return (
    <ScreenErrorBoundary>
      <ScreenSafeAreaView hasNativeHeader testID="activity-summary-screen" style={shared.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {awaitingActivity ? (
            <View style={styles.waiting} testID="activity-summary-waiting">
              <MaterialCommunityIcons
                name="cloud-download-outline"
                size={40}
                color={themeColors.textSecondary}
              />
              <Text style={[styles.waitingText, shared.textSecondary]}>
                {t('activitySummary.fetching')}
              </Text>
            </View>
          ) : null}

          {activity ? (
            <>
              {/*
               * The verdict costs three engine reads, so it lands a tick after
               * the figures rather than blocking the mount. It is held back
               * whole until it resolves: a default rung painted first would
               * read "Activity Recorded" and then change to "New PR", which is
               * worse than arriving a frame late.
               */}
              {highlight ? (
                <View style={styles.verdict} testID="activity-summary-verdict">
                  <MaterialCommunityIcons
                    name={TIER_ICONS[highlight.tier]}
                    size={32}
                    color={colors.primary}
                  />
                  <Text style={[styles.tier, shared.text]}>{highlight.title}</Text>
                </View>
              ) : null}

              {highlight?.sentence ? (
                <Text style={[styles.sentence, shared.text]} testID="activity-summary-sentence">
                  {highlight.sentence}
                </Text>
              ) : null}

              <Text style={[styles.activityName, shared.textSecondary]}>{activity.name}</Text>

              <View style={styles.figures} testID="activity-summary-figures">
                <Figure
                  label={t('activitySummary.distance')}
                  value={formatDistance(activity.distance, isMetric)}
                  isDark={isDark}
                />
                <Figure
                  label={t('activitySummary.movingTime')}
                  value={formatDuration(activity.moving_time)}
                  isDark={isDark}
                />
                <Figure
                  label={t('activitySummary.elevation')}
                  value={`${Math.round(activity.total_elevation_gain)} m`}
                  isDark={isDark}
                />
              </View>

              <Button
                label={t('activitySummary.openActivity')}
                onPress={() => router.push(`/activity/${id}` as never)}
                testID="activity-summary-open"
              />
            </>
          ) : null}
        </ScrollView>
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
  );
}

function Figure({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  const shared = createSharedStyles(isDark);
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureValue, shared.text]}>{value}</Text>
      <Text style={[styles.figureLabel, shared.textSecondary]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  waiting: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  waitingText: {
    fontSize: typography.body.fontSize,
    textAlign: 'center',
  },
  verdict: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  tier: {
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: typography.sectionTitle.fontWeight,
  },
  sentence: {
    fontSize: typography.cardTitle.fontSize,
    lineHeight: typography.cardTitle.fontSize * 1.4,
  },
  activityName: {
    fontSize: typography.body.fontSize,
  },
  figures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  figure: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
  },
  figureValue: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight,
  },
  figureLabel: {
    fontSize: typography.caption.fontSize,
  },
});
