import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Text as RNText } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, useMetricSystem } from '@/shared/app';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as haptics from '@/shared/ui/haptics';
import { useTranslation } from 'react-i18next';
import type { Activity } from '@/types';
import { getActivityIcon, getActivityColor, getActivityInk } from '@/shared/activity/activityUtils';
import {
  formatHeartRate,
  formatPower,
  formatRelativeDateTime,
  formatTemperature,
  formatLoad,
  formatCalories,
  formatPrDelta,
  formatPrImprovement,
} from '@/shared/format/format';
import {
  colors,
  darkColors,
  typography,
  spacing,
  layout,
  brand,
  ink,
  verdict,
  colorWithOpacity,
  mapTextShadow,
  slopToMinTapTarget,
} from '@/theme';
import { useMapPreferences } from '@/features/settings';
import { type TerrainSnapshotWebViewRef } from '@/features/maps';
import { ActivityMapPreview } from './ActivityMapPreview';
import type { PreviewTrack } from '@/features/home';
import { ActivityCardContextMenu } from './ActivityCardContextMenu';
import { SkylineBar } from './SkylineBar';
import { cardPrimaryStats } from '../lib/cardPrimaryStats';
import { StrengthActivityCard, type StrengthCardData } from '@/features/strength';
import { debug } from '@/shared/debug/debug';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';
import { prefetchActivityDetailData } from '../hooks/useActivityDetailData';
import type { ActivityNewGround } from '../hooks/useActivitySectionHighlights';
import {
  accessibleActions,
  composeAccessibilityLabel,
  pressable,
  pressRipple,
  pressRippleOver,
} from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { contextMenuHoldIsNative } from '@/shared/ui/ContextMenu';
import { activityCardA11yLabel, routeChipSpeech } from '../lib/activityCardA11yLabel';
import { freshLoginTimeline } from '@/shared/debug/freshLoginTimeline';

import { CARD_HEIGHT, CARD_MARGIN } from '@/features/activity/lib/cardLayout';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';
import { tapTo } from '@/shared/app/navigation';

const log = debug.create('ActivityCard');

interface ActivityCardProps {
  activity: Activity;
  index?: number | undefined;
  /** Ref to the shared snapshot WebView for 3D terrain previews */
  snapshotRef?: React.RefObject<TerrainSnapshotWebViewRef | null> | undefined;
  /** Pre-fetched GPS track from startup data */
  startupTrack?: PreviewTrack | undefined;
  /** Whether snapshot WebView workers are ready */
  snapshotReady?: boolean | undefined;
  /** What a strength card paints, from the feed's one batched read. Absent draws an ordinary card. */
  strengthData?: StrengthCardData | undefined;
  /** Forces re-render when theme changes (enableFreeze suppresses useColorScheme updates) */
  colorScheme?: boolean | undefined;
  /** Section highlights for this activity (PRs, trends) from batch FFI query */
  sectionHighlights?:
    | {
        sectionName: string;
        isPr: boolean;
        trend: number; // -1=slower, 0=neutral, 1=faster vs preceding avg
        startIndex: number;
        endIndex: number;
      }[]
    | undefined;
  /** Tile coverage against earlier activities; the badge is decided in the engine */
  newGround?: ActivityNewGround | undefined;
  /** Route highlight for this activity (trend, PR) */
  routeHighlight?:
    | {
        routeName: string;
        isPr: boolean;
        trend: number; // -1=slower, 0=neutral, 1=faster
        timeDeltaSeconds?: number | null | undefined;
        prImprovementSeconds?: number | null | undefined;
      }
    | undefined;
}

// White text theme (used on any dark/satellite map, or dark theme + light map)
const WHITE_TEXT = {
  text: ink.white,
  textSecondary: colorWithOpacity(ink.white, 0.85),
  dot: colorWithOpacity(ink.white, 0.5),
  divider: colorWithOpacity(ink.white, 0.15),
  secondaryText: colorWithOpacity(ink.white, 0.9),
  shadow: colorWithOpacity(ink.black, 0.8),
};

// Dark text theme (only for light theme + light map)
const DARK_TEXT = {
  text: colors.textPrimary,
  textSecondary: colors.textSecondary,
  dot: colorWithOpacity(ink.black, 0.25),
  divider: colorWithOpacity(ink.black, 0.1),
  secondaryText: colors.textSecondary,
  shadow: colorWithOpacity(ink.white, 0.8),
};

// Gradient + text combos driven by app theme x map style
const GRADIENT = {
  // Light theme + light map: white wash blends into light UI
  lightLight: {
    top: [
      colorWithOpacity(ink.white, 0.92),
      colorWithOpacity(ink.white, 0.5),
      'transparent',
    ] as const,
    bottom: [
      'transparent',
      colorWithOpacity(ink.white, 0.6),
      colorWithOpacity(ink.white, 0.95),
    ] as const,
    ...DARK_TEXT,
  },
  // Light theme + dark map: subtle scrim, map already provides contrast
  lightDark: {
    top: [
      colorWithOpacity(ink.black, 0.5),
      colorWithOpacity(ink.black, 0.2),
      'transparent',
    ] as const,
    bottom: [
      'transparent',
      colorWithOpacity(ink.black, 0.25),
      colorWithOpacity(ink.black, 0.55),
    ] as const,
    ...WHITE_TEXT,
  },
  // Dark theme + light map: strong dark scrim to blend into dark UI
  darkLight: {
    top: [
      colorWithOpacity(ink.black, 0.7),
      colorWithOpacity(ink.black, 0.3),
      'transparent',
    ] as const,
    bottom: [
      'transparent',
      colorWithOpacity(ink.black, 0.35),
      colorWithOpacity(ink.black, 0.72),
    ] as const,
    ...WHITE_TEXT,
  },
  // Dark theme + dark map: subtle scrim, everything already dark
  darkDark: {
    top: [
      colorWithOpacity(ink.black, 0.5),
      colorWithOpacity(ink.black, 0.2),
      'transparent',
    ] as const,
    bottom: [
      'transparent',
      colorWithOpacity(ink.black, 0.25),
      colorWithOpacity(ink.black, 0.6),
    ] as const,
    ...WHITE_TEXT,
  },
};

function getGradientTheme(isDark: boolean, mapStyle: string) {
  const isMapDark = mapStyle === 'dark' || mapStyle === 'satellite';
  if (isDark) return isMapDark ? GRADIENT.darkDark : GRADIENT.darkLight;
  return isMapDark ? GRADIENT.lightDark : GRADIENT.lightLight;
}

export const ActivityCard = React.memo(
  function ActivityCard({
    activity,
    index,
    snapshotRef,
    startupTrack,
    snapshotReady,
    sectionHighlights,
    routeHighlight,
    newGround,
    strengthData,
  }: ActivityCardProps) {
    // Log actual function body execution (not useEffect which is deferred)
    if (__DEV__ && (index ?? 0) < 3) {
      log.log(`  🃏 ActivityCard[${index}] BODY executing (${activity.type})`);
    }
    const { t } = useTranslation();
    const { isDark, preferOpaqueChrome } = useTheme();
    const isMetric = useMetricSystem();
    const [menuVisible, setMenuVisible] = useState(false);
    const averageHeartRate = activity.average_heartrate;
    const averagePower = activity.icu_average_watts;
    useEffect(() => {
      freshLoginTimeline.mark('firstCard');
    }, []);

    // The detail bundle is read here rather than after the push animation, so
    // the screen paints with it on its first render.
    const openActivity = useCallback(
      (tab?: 'routes' | 'sections') => {
        prefetchActivityDetailData(activity.id);
        tapTo(`/activity/${activity.id}${tab ? `?tab=${tab}` : ''}`);
      },
      [activity.id]
    );

    const handlePress = useCallback(() => openActivity(), [openActivity]);

    const handleLongPress = useCallback(() => {
      haptics.medium();
      setMenuVisible(true);
    }, []);

    const showsRouteChip =
      !!routeHighlight &&
      (routeHighlight.isPr ||
        (routeHighlight.timeDeltaSeconds != null && routeHighlight.timeDeltaSeconds > 0));
    const showsSectionChip = !!sectionHighlights && sectionHighlights.length > 0;

    // The chips and the hold sit inside the card's one element, so a screen
    // reader reaches them here.
    const cardActions = useMemo(
      () =>
        accessibleActions([
          ...(showsRouteChip
            ? [
                {
                  name: 'openRoute',
                  label: t('activityDetail.tabs.route'),
                  run: () => openActivity('routes'),
                },
              ]
            : []),
          ...(showsSectionChip
            ? [
                {
                  name: 'openSections',
                  label: t('activityDetail.tabs.sections'),
                  run: () => openActivity('sections'),
                },
              ]
            : []),
          { name: 'longpress', label: t('activity.moreActions'), run: handleLongPress },
        ]),
      [showsRouteChip, showsSectionChip, openActivity, handleLongPress, t]
    );

    const scrollRef = useRef<ScrollView>(null);
    const hasFlashed = useRef(false);

    const handleContentSizeChange = useCallback((_contentWidth: number, _contentHeight: number) => {
      if (!hasFlashed.current && scrollRef.current) {
        hasFlashed.current = true;
        setTimeout(() => scrollRef.current?.flashScrollIndicators(), 400);
      }
    }, []);

    const { getStyleForActivity } = useMapPreferences();
    const activityColor = getActivityColor(activity.type);
    const activityInk = getActivityInk(activity.type, isDark);
    const iconName = getActivityIcon(activity.type);
    const mapStyle = getStyleForActivity(activity.type, activity.id);
    const theme = getGradientTheme(isDark, mapStyle);
    const hasGpsData = activity.stream_types?.includes('latlng');

    const compactTextColor = isDark ? darkColors.textPrimary : colors.textPrimary;
    const compactMutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
    const compactDotColor = isDark
      ? colorWithOpacity(ink.white, 0.3)
      : colorWithOpacity(ink.black, 0.25);
    const compactDividerColor = isDark ? darkColors.border : colorWithOpacity(ink.black, 0.1);

    // Shared secondary stats row used by both compact and full card
    const secondaryStatsRow = (textColor: string) => (
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={handleContentSizeChange}
        testID={`activity-card-${activity.id}-secondary-stats`}
        style={styles.secondaryScroll}
      >
        {/* A second touch area for the card's own press. The card's label speaks
            these stats, so a screen reader never reaches this. */}
        <Pressable
          accessible={false}
          accessibilityRole="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          onPress={handlePress}
          style={pressable(styles.secondaryStats)}
          android_ripple={pressRipple}
        >
          {!!activity.icu_training_load && (
            <View style={styles.secondaryStat}>
              <MaterialCommunityIcons name="fire" size={14} color={colors.primary} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatLoad(activity.icu_training_load)}
              </RNText>
            </View>
          )}
          {averageHeartRate ? (
            <View style={styles.secondaryStat}>
              <MaterialCommunityIcons name="heart-pulse" size={14} color={colors.error} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatHeartRate(averageHeartRate)}
              </RNText>
            </View>
          ) : null}
          {averagePower ? (
            <View style={styles.secondaryStat}>
              <MaterialCommunityIcons
                name="lightning-bolt"
                size={14}
                color={isDark ? darkColors.warningAmber : colors.warningAmber}
              />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatPower(averagePower)}
              </RNText>
            </View>
          ) : null}
          {!!activity.calories && (
            <View style={styles.secondaryStat}>
              <MaterialCommunityIcons
                name="food-apple"
                size={14}
                color={isDark ? darkColors.successDeep : colors.successDeep}
              />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatCalories(activity.calories)}
              </RNText>
            </View>
          )}
          {activity.has_weather && activity.average_weather_temp != null && (
            <View style={styles.secondaryStat}>
              <MaterialCommunityIcons name="weather-partly-cloudy" size={14} color={colors.info} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatTemperature(activity.average_weather_temp, isMetric)}
              </RNText>
            </View>
          )}
        </Pressable>
      </ScrollView>
    );

    const sectionCounts = {
      prs: sectionHighlights?.filter((h) => h.isPr).length ?? 0,
      faster: sectionHighlights?.filter((h) => h.trend === 1 && !h.isPr).length ?? 0,
      slower: sectionHighlights?.filter((h) => h.trend === -1 && !h.isPr).length ?? 0,
    };

    // The menu a hold opens wraps the card it belongs to, compact or full, and
    // offers map controls only on the card that draws a map.
    const withMenu = (card: React.ReactElement, hasMap: boolean) => (
      <ActivityCardContextMenu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        activity={activity}
        hasMap={hasMap}
      >
        {card}
      </ActivityCardContextMenu>
    );
    const onHold = contextMenuHoldIsNative() ? undefined : handleLongPress;

    // The feed reads every strength card's summary in one engine call and hands
    // each card its own.
    const isStrength = activity.type === 'WeightTraining';

    if (isStrength && strengthData) {
      return <StrengthActivityCard activity={activity} strengthData={strengthData} />;
    }

    const stats = cardPrimaryStats(activity, isMetric);

    // Compact card for activities without GPS data
    if (!hasGpsData) {
      return withMenu(
        <View style={styles.cardWrapper}>
          <Pressable
            testID={`activity-card-${activity.id}`}
            onPress={handlePress}
            onLongPress={onHold}
            delayLongPress={PREVIEW_HOLD_MS}
            accessibilityRole="button"
            accessibilityLabel={activityCardA11yLabel({ activity, isMetric }, t)}
            {...cardActions}
            style={pressable()}
            android_ripple={pressRippleOver}
          >
            <Card variant="raised" padding="none" testID={`activity-card-${activity.id}-container`}>
              {/* Read through the card's own label, so the name is heard once. */}
              <View
                style={styles.compactContent}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {/* Header: icon + name/date stacked + no-map indicator */}
                <View style={styles.compactHeader}>
                  <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                    <MaterialCommunityIcons name={iconName} size={14} color={colors.textOnDark} />
                  </View>
                  <View style={styles.compactTitleColumn}>
                    <View style={styles.compactNameRow}>
                      <RNText
                        style={[styles.compactName, { color: compactTextColor }]}
                        numberOfLines={1}
                      >
                        {activity.name}
                      </RNText>
                      <MaterialCommunityIcons
                        name="map-marker-off"
                        size={14}
                        color={activityInk}
                        style={styles.compactNoMapIcon}
                      />
                    </View>
                    <RNText
                      style={[styles.compactDateSubtitle, { color: compactMutedColor }]}
                      numberOfLines={1}
                    >
                      {formatRelativeDateTime(activity.start_date_local)}
                    </RNText>
                  </View>
                </View>

                {/* Primary stats */}
                <View style={styles.compactPrimaryRow}>
                  <View style={styles.primaryStats}>
                    {stats.distance != null && (
                      <>
                        <RNText
                          testID={`activity-card-${activity.id}-distance`}
                          style={[styles.compactStatValue, { color: compactTextColor }]}
                        >
                          {stats.distance}
                        </RNText>
                        <RNText style={[styles.statDot, { color: compactDotColor }]}>·</RNText>
                      </>
                    )}
                    <RNText
                      testID={`activity-card-${activity.id}-duration`}
                      style={[styles.compactStatValue, { color: compactTextColor }]}
                    >
                      {stats.duration}
                    </RNText>
                    {stats.elevation != null && (
                      <>
                        <RNText style={[styles.statDot, { color: compactDotColor }]}>·</RNText>
                        <RNText
                          testID={`activity-card-${activity.id}-elevation`}
                          style={[styles.compactStatValue, { color: compactTextColor }]}
                        >
                          {stats.elevation}
                        </RNText>
                      </>
                    )}
                  </View>
                </View>

                {/* Skyline bar or divider */}
                {activity.skyline_chart_bytes ? (
                  <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
                ) : (
                  <View style={[styles.dividerLine, { backgroundColor: compactDividerColor }]} />
                )}

                {/* Secondary stats */}
                {secondaryStatsRow(compactMutedColor)}
              </View>
            </Card>
          </Pressable>
        </View>,
        false
      );
    }

    return withMenu(
      <View style={styles.cardWrapper}>
        <Card variant="raised" padding="none" testID={`activity-card-${activity.id}-container`}>
          <View style={styles.mapContainer}>
            <ActivityMapPreview
              activity={activity}
              height={240}
              index={index}
              snapshotRef={snapshotRef}
              snapshotReady={snapshotReady}
              startupTrack={startupTrack}
            />

            {/* Pressable overlay for tap/long-press */}
            <Pressable
              testID={`activity-card-${activity.id}`}
              onPress={handlePress}
              onLongPress={onHold}
              delayLongPress={PREVIEW_HOLD_MS}
              style={pressable(styles.pressableOverlay)}
              android_ripple={pressRipple}
              accessibilityRole="button"
              accessibilityLabel={activityCardA11yLabel(
                {
                  activity,
                  isMetric,
                  sectionHighlights,
                  routeHighlight,
                  newGround,
                },
                t
              )}
              {...cardActions}
            />

            {/* Top gradient: sport icon + name/date stacked + route trend. Read
                through the overlay's label and actions, so the name is heard once. */}
            <LinearGradient
              colors={theme.top as [string, string, string]}
              style={styles.topOverlay}
              pointerEvents="box-none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={styles.overlayHeader} pointerEvents="box-none">
                <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                  <MaterialCommunityIcons name={iconName} size={14} color={colors.textOnDark} />
                </View>
                <View style={styles.overlayTitleColumn}>
                  <RNText
                    style={[
                      styles.overlayName,
                      { color: theme.text, textShadowColor: theme.shadow },
                    ]}
                    numberOfLines={1}
                  >
                    {activity.name}
                  </RNText>
                  <RNText
                    style={[
                      styles.overlayDateSubtitle,
                      { color: theme.textSecondary, textShadowColor: theme.shadow },
                    ]}
                    numberOfLines={1}
                  >
                    {formatRelativeDateTime(activity.start_date_local)}
                  </RNText>
                </View>
                {routeHighlight && showsRouteChip && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={composeAccessibilityLabel(
                      t('activityDetail.tabs.route'),
                      routeHighlight.routeName,
                      routeChipSpeech(routeHighlight, t)
                    )}
                    testID={`activity-card-${activity.id}-route-chip`}
                    onPress={() => openActivity('routes')}
                    hitSlop={CHIP_SLOP}
                    style={pressable([
                      styles.routeTrendBadge,
                      routeHighlight.isPr
                        ? isDark
                          ? styles.routeTrendBadgePrDark
                          : styles.routeTrendBadgePrLight
                        : preferOpaqueChrome
                          ? styles.routeTrendBadgeDeltaOpaque
                          : styles.routeTrendBadgeDelta,
                    ])}
                    android_ripple={pressRipple}
                  >
                    {routeHighlight.isPr ? (
                      <>
                        <MaterialCommunityIcons
                          name="trophy"
                          size={PILL_ICON_SIZE}
                          color={colors.textOnPrimary}
                        />
                        {formatPrImprovement(routeHighlight.prImprovementSeconds) != null && (
                          <RNText
                            testID={`activity-card-${activity.id}-route-improvement`}
                            style={[styles.routeTrendBadgeText, styles.routeTrendBadgePrText]}
                          >
                            {formatPrImprovement(routeHighlight.prImprovementSeconds)}
                          </RNText>
                        )}
                      </>
                    ) : routeHighlight.timeDeltaSeconds != null ? (
                      <RNText style={styles.routeTrendBadgeText}>
                        {formatPrDelta(routeHighlight.timeDeltaSeconds)}
                      </RNText>
                    ) : null}
                  </Pressable>
                )}
              </View>
            </LinearGradient>

            {/* Bottom: all stats unified */}
            <View
              testID="activity-card-bottom"
              style={styles.bottomSection}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <LinearGradient
                colors={theme.bottom as [string, string, string]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              {/* Primary stats: a second touch area for the card's own press,
                    spoken in the card's label. The section chip inside is
                    reached through the card's actions. */}
              <Pressable
                accessible={false}
                accessibilityRole="none"
                onPress={handlePress}
                style={pressable(styles.primaryRow)}
                android_ripple={pressRipple}
              >
                <View
                  style={styles.primaryStats}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  {stats.distance != null && (
                    <>
                      <RNText
                        testID={`activity-card-${activity.id}-distance`}
                        style={[
                          styles.primaryStatValue,
                          { color: theme.text, textShadowColor: theme.shadow },
                        ]}
                      >
                        {stats.distance}
                      </RNText>
                      <RNText style={[styles.statDot, { color: theme.dot }]}>·</RNText>
                    </>
                  )}
                  <RNText
                    testID={`activity-card-${activity.id}-duration`}
                    style={[
                      styles.primaryStatValue,
                      { color: theme.text, textShadowColor: theme.shadow },
                    ]}
                  >
                    {stats.duration}
                  </RNText>
                  {stats.elevation != null && (
                    <>
                      <RNText style={[styles.statDot, { color: theme.dot }]}>·</RNText>
                      <RNText
                        testID={`activity-card-${activity.id}-elevation`}
                        style={[
                          styles.primaryStatValue,
                          { color: theme.text, textShadowColor: theme.shadow },
                        ]}
                      >
                        {stats.elevation}
                      </RNText>
                    </>
                  )}
                </View>
                {/* Right column: ground coverage, section trend indicators + PR counts. */}
                {newGround?.badge || showsSectionChip ? (
                  <View style={styles.rightColumn}>
                    {newGround?.badge && (
                      <View
                        testID={`activity-card-${activity.id}-new-ground-pill`}
                        style={[styles.trendPill, styles.newGroundPill]}
                        importantForAccessibility="no-hide-descendants"
                        accessibilityElementsHidden
                      >
                        <MaterialCommunityIcons
                          name="compass-outline"
                          size={PILL_ICON_SIZE}
                          color={ink.white}
                        />
                        <RNText style={[styles.trendCount, { color: ink.white }]}>
                          {newGround.badge === 'entirelyNew'
                            ? t('activity.newGround')
                            : t('activity.mostlyNewGround')}
                        </RNText>
                      </View>
                    )}
                    {sectionHighlights && showsSectionChip && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={composeAccessibilityLabel(
                          t('activityDetail.tabs.sections'),
                          sectionCounts.prs > 0 && t('a11y.prs', { n: sectionCounts.prs }),
                          sectionCounts.faster > 0 && t('a11y.faster', { n: sectionCounts.faster }),
                          sectionCounts.slower > 0 && t('a11y.slower', { n: sectionCounts.slower })
                        )}
                        testID={`activity-card-${activity.id}-section-chip`}
                        onPress={() => openActivity('sections')}
                        hitSlop={CHIP_SLOP}
                        style={pressable(styles.trendBadge)}
                        android_ripple={pressRipple}
                      >
                        {(() => {
                          const {
                            faster: improving,
                            slower: declining,
                            prs: prCount,
                          } = sectionCounts;
                          return (
                            <>
                              {prCount > 0 && (
                                <View
                                  testID={`activity-card-${activity.id}-pr-pill`}
                                  style={[
                                    styles.trendPill,
                                    isDark ? styles.prPillDark : styles.prPillLight,
                                  ]}
                                >
                                  <MaterialCommunityIcons
                                    name="trophy"
                                    size={PILL_ICON_SIZE}
                                    color={colors.textOnPrimary}
                                  />
                                  <RNText
                                    style={[styles.trendCount, { color: colors.textOnPrimary }]}
                                  >
                                    {prCount}
                                  </RNText>
                                </View>
                              )}
                              {improving > 0 && (
                                <View
                                  testID={`activity-card-${activity.id}-improving-pill`}
                                  style={[
                                    styles.trendPill,
                                    isDark ? styles.improvingPillDark : styles.improvingPillLight,
                                  ]}
                                >
                                  <MaterialCommunityIcons
                                    name="trending-up"
                                    size={PILL_ICON_SIZE}
                                    color={ink.white}
                                  />
                                  <RNText style={[styles.trendCount, { color: ink.white }]}>
                                    {improving}
                                  </RNText>
                                </View>
                              )}
                              {declining > 0 && (
                                <View
                                  testID={`activity-card-${activity.id}-declining-pill`}
                                  style={[
                                    styles.trendPill,
                                    isDark ? styles.decliningPillDark : styles.decliningPillLight,
                                  ]}
                                >
                                  <MaterialCommunityIcons
                                    name="trending-down"
                                    size={PILL_ICON_SIZE}
                                    color={ink.white}
                                  />
                                  <RNText style={[styles.trendCount, { color: ink.white }]}>
                                    {declining}
                                  </RNText>
                                </View>
                              )}
                            </>
                          );
                        })()}
                      </Pressable>
                    )}
                  </View>
                ) : null}
              </Pressable>
              {activity.skyline_chart_bytes ? (
                <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
              ) : (
                <View style={[styles.dividerLine, { backgroundColor: theme.divider }]} />
              )}
              {secondaryStatsRow(theme.secondaryText)}
            </View>
          </View>
        </Card>
      </View>,
      true
    );
  },
  (prev, next) =>
    rowIsUnchanged(
      {
        record: prev.activity,
        extras: [
          prev.index,
          prev.startupTrack,
          prev.colorScheme,
          prev.snapshotReady,
          prev.sectionHighlights,
          prev.routeHighlight,
          prev.newGround,
          prev.strengthData,
        ],
      },
      {
        record: next.activity,
        extras: [
          next.index,
          next.startupTrack,
          next.colorScheme,
          next.snapshotReady,
          next.sectionHighlights,
          next.routeHighlight,
          next.newGround,
          next.strengthData,
        ],
      }
    )
);

/** Icon size shared by the route chip and the section pills. */
const PILL_ICON_SIZE = 13;

/** Shape shared by the route chip and the section pills. */
const PILL_BORDER = 1;
const pillShape = {
  borderRadius: layout.borderRadiusSm,
  paddingHorizontal: spacing.xsPlus,
  paddingVertical: spacing.xxs,
  borderWidth: PILL_BORDER,
} as const;

// The chips sit on the card, which is its own press target, so the slop only
// lifts their height and leaves the card's area beside them alone.
const PILL_HEIGHT = typography.pillValue.lineHeight + 2 * (spacing.xxs + PILL_BORDER);
const CHIP_SLOP = slopToMinTapTarget(PILL_HEIGHT);

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: CARD_MARGIN,
    marginBottom: CARD_MARGIN,
  },
  mapContainer: {
    position: 'relative',
    height: CARD_HEIGHT,
  },
  pressableOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.smPlus,
    paddingHorizontal: spacing.smPlus,
    paddingBottom: spacing.lg,
    zIndex: 2,
  },
  overlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTitleColumn: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  routeTrendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginLeft: spacing.sm,
    ...pillShape,
  },
  routeTrendBadgePrLight: {
    backgroundColor: brand.gold,
    borderColor: brand.goldDark,
  },
  routeTrendBadgePrDark: {
    backgroundColor: brand.gold,
    borderColor: brand.goldLight,
  },
  routeTrendBadgeDelta: {
    backgroundColor: colorWithOpacity(ink.black, 0.55),
    borderColor: colorWithOpacity(ink.white, 0.2),
  },
  // Reduce Transparency or a contrast setting: the same dark chip in both
  // themes, holding its own contrast rather than taking it from the map.
  routeTrendBadgeDeltaOpaque: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  routeTrendBadgeText: {
    ...typography.pillValue,
    color: ink.white,
  },
  routeTrendBadgePrText: {
    color: colors.textOnPrimary,
  },
  overlayName: {
    ...typography.cardTitle,
    ...mapTextShadow,
  },
  overlayDateSubtitle: {
    ...typography.caption,
    fontWeight: '500',
    marginTop: spacing.xxs,
    ...mapTextShadow,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  primaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.smPlus,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxs,
  },
  rightColumn: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: spacing.xxs,
    marginLeft: spacing.sm,
    flexShrink: 1,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    ...pillShape,
  },
  // PR pill - solid gold, high contrast
  prPillLight: {
    backgroundColor: brand.gold,
    borderColor: brand.goldDark,
  },
  prPillDark: {
    backgroundColor: brand.gold,
    borderColor: brand.goldLight,
  },
  // Ground pill - the teal ladder's dark rung, white text on a solid
  newGroundPill: {
    backgroundColor: brand.tealHover,
    borderColor: brand.tealLight,
  },
  // Improving pill - solid green
  improvingPillLight: {
    backgroundColor: verdict.positive.light,
    borderColor: verdict.positive.dark,
  },
  improvingPillDark: {
    backgroundColor: verdict.positive.light,
    borderColor: verdict.positive.dark,
  },
  // Declining pill - the negative rung, the same verdict the section trend and
  // the insight card draw. It was disabled-grey, so the same decline read as
  // "off" here and as a judgement one card away. The light tone carries the
  // pill in both themes, the way the improving pill does:
  // the ladder's dark rungs are sized for text on a surface, not for white
  // text on a solid.
  decliningPillLight: {
    backgroundColor: verdict.negative.light,
    borderColor: verdict.negative.dark,
  },
  decliningPillDark: {
    backgroundColor: verdict.negative.light,
    borderColor: verdict.negative.dark,
  },
  trendCount: {
    ...typography.pillValue,
  },
  primaryStats: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  primaryStatValue: {
    ...typography.body,
    fontWeight: '700',
    ...mapTextShadow,
  },
  statDot: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    marginHorizontal: spacing.xsPlus,
  },
  dividerLine: {
    height: 1,
    marginHorizontal: spacing.smPlus,
  },
  secondaryScroll: {
    // The record button floats over the feed's bottom right; the row ends short of it.
    marginRight: layout.recordFabSize + spacing.xl,
    paddingTop: spacing.xxs,
    paddingBottom: spacing.sm,
  },
  secondaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.smPlus,
    gap: spacing.smPlus,
  },
  secondaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  secondaryStatValue: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  compactContent: {
    padding: spacing.smPlus,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactTitleColumn: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  compactNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactName: {
    flex: 1,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  compactNoMapIcon: {
    marginLeft: spacing.xsPlus,
    opacity: 0.5,
  },
  compactDateSubtitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    marginTop: spacing.xxs,
  },
  compactPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: spacing.xsPlus,
    paddingBottom: spacing.xxs,
  },
  compactStatValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
