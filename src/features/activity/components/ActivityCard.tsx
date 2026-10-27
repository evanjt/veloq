import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Text as RNText,
  type ScrollViewInstance,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import type { ActivityType, FeedCard } from '@/types';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import {
  formatHeartRate,
  formatPower,
  formatRelativeDateTime,
  formatTemperature,
  formatLoad,
  formatCalories,
  formatPrGap,
} from '@/shared/format/format';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layers,
  layout,
  mapTextShadow,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { useMapPreferences } from '@/features/settings';
import { type TerrainSnapshotWebViewRef } from '@/features/maps';
import { ActivityMapPreview } from './ActivityMapPreview';
import type { PreviewTrack } from '@/features/home';
import { ActivityCardContextMenu } from './ActivityCardContextMenu';
import { ActivitySyncFailureChip } from './ActivitySyncFailure';
import { ActivityStubAction } from './ActivityStubAction';
import { useRetryActivitySync } from '../hooks/useRetryActivitySync';
import { SkylineBar } from './SkylineBar';
import { cardPrimaryStats } from '../lib/cardPrimaryStats';
import { StrengthActivityCard, type StrengthCardData } from '@/features/strength';
import { debug } from '@/shared/debug/debug';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';
import { prefetchActivityDetailData } from '../hooks/useActivityDetailData';
import {
  accessibleActions,
  composeAccessibilityLabel,
  useLargeText,
  PressTarget,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { Badge, BADGE_HEIGHT } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { contextMenuHoldIsNative } from '@/shared/ui/ContextMenu';
import { activityCardA11yLabel, routeChipSpeech } from '../lib/activityCardA11yLabel';
import { freshLoginTimeline } from '@/shared/debug/freshLoginTimeline';

import { CARD_HEIGHT, cardContainers } from '@/features/activity/lib/cardLayout';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';
import { navigateTo } from '@/shared/app/navigation';
import { NameText } from '@/shared/ui/NameText';
import { FitText } from '@/shared/ui/FitText';

const log = debug.create('ActivityCard');

interface ActivityCardProps {
  activity: FeedCard;
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
  dot: colorWithOpacity(ink.white, opacity.disabled),
  divider: colorWithOpacity(ink.white, opacity.tint2),
  secondaryText: colorWithOpacity(ink.white, 0.9),
  shadow: colorWithOpacity(ink.black, 0.8),
};

// Dark text theme (only for light theme + light map)
const DARK_TEXT = {
  text: colors.textPrimary,
  textSecondary: colors.textSecondary,
  dot: colorWithOpacity(ink.black, opacity.tint4),
  divider: colorWithOpacity(ink.black, opacity.tint2),
  secondaryText: colors.textSecondary,
  shadow: colorWithOpacity(ink.white, 0.8),
};

// Gradient + text combos driven by app theme x map style
const GRADIENT = {
  // Light theme + light map: white wash blends into light UI
  lightLight: {
    top: [
      colorWithOpacity(ink.white, 0.92),
      colorWithOpacity(ink.white, opacity.disabled),
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
      colorWithOpacity(ink.black, opacity.disabled),
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
      colorWithOpacity(ink.black, opacity.pressed),
      colorWithOpacity(ink.black, opacity.tint4),
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
      colorWithOpacity(ink.black, opacity.disabled),
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
    strengthData,
  }: ActivityCardProps) {
    // Log actual function body execution (not useEffect which is deferred)
    if (__DEV__ && (index ?? 0) < 3) {
      log.log(`  🃏 ActivityCard[${index}] BODY executing (${activity.sportType})`);
    }
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const palette = themePalette(isDark);
    const isMetric = useMetricSystem();
    const [menuVisible, setMenuVisible] = useState(false);
    const largeText = useLargeText();
    const averageHeartRate = activity.avgHr;
    const averagePower = activity.avgPower;
    useEffect(() => {
      freshLoginTimeline.mark('firstCard');
    }, []);

    // The detail bundle is read here rather than after the push animation, so
    // the screen paints with it on its first render.
    const openActivity = useCallback(
      (tab?: 'routes' | 'sections') => {
        prefetchActivityDetailData(activity.id);
        navigateTo(`/activity/${activity.id}${tab ? `?tab=${tab}` : ''}`);
      },
      [activity.id]
    );

    const handlePress = useCallback(() => openActivity(), [openActivity]);
    const { retry: retrySync, retrying: retryingSync } = useRetryActivitySync(activity.id);
    const syncFailed = !!activity.syncFailure;

    const handleLongPress = useCallback(() => {
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
          ...(syncFailed
            ? [
                {
                  name: 'retrySync',
                  label: composeAccessibilityLabel(
                    t('activity.syncFailed.title'),
                    t('common.retry')
                  ),
                  run: retrySync,
                },
              ]
            : []),
          { name: 'longpress', label: t('activity.moreActions'), run: handleLongPress },
        ]),
      [showsRouteChip, showsSectionChip, syncFailed, openActivity, retrySync, handleLongPress, t]
    );

    const scrollRef = useRef<ScrollViewInstance>(null);
    const hasFlashed = useRef(false);

    const handleContentSizeChange = useCallback((_contentWidth: number, _contentHeight: number) => {
      if (!hasFlashed.current && scrollRef.current) {
        hasFlashed.current = true;
        setTimeout(() => scrollRef.current?.flashScrollIndicators(), 400);
      }
    }, []);

    const { getStyleForActivity } = useMapPreferences();
    // A body with no sport falls back to Other in every helper, as it always has.
    const sport = activity.sportType as ActivityType;
    const activityColor = sportMarkColour(sport, isDark);
    const iconName = getActivityIcon(sport);
    const mapStyle = getStyleForActivity(sport, activity.id);
    const theme = getGradientTheme(isDark, mapStyle);
    const hasGpsData = activity.hasGps;

    const compactTextColor = isDark ? darkColors.textPrimary : colors.textPrimary;
    const compactMutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
    const compactDotColor = isDark
      ? colorWithOpacity(ink.white, opacity.tint4)
      : colorWithOpacity(ink.black, opacity.tint4);
    const compactDividerColor = isDark
      ? darkColors.border
      : colorWithOpacity(ink.black, opacity.tint2);
    // Text on the card's own surface, where nothing behind it needs a shadow.
    const surfaceText = {
      text: compactTextColor,
      textSecondary: compactMutedColor,
      dot: compactDotColor,
      divider: compactDividerColor,
      secondaryText: compactMutedColor,
      shadow: 'transparent',
    };

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
        <PressTarget
          accessible={false}
          accessibilityRole="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          onPress={handlePress}
          style={styles.secondaryStats}
        >
          {!!activity.trainingLoad && (
            <View style={styles.secondaryStat}>
              <Icon name="fire" size={iconSize.sm} color={palette.actionPrimary} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatLoad(activity.trainingLoad)}
              </RNText>
            </View>
          )}
          {averageHeartRate ? (
            <View style={styles.secondaryStat}>
              <Icon name="heart-pulse" size={iconSize.sm} color={colors.errorText} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatHeartRate(averageHeartRate)}
              </RNText>
            </View>
          ) : null}
          {averagePower ? (
            <View style={styles.secondaryStat}>
              <Icon
                name="lightning-bolt"
                size={iconSize.sm}
                color={isDark ? darkColors.warningText : colors.warningText}
              />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatPower(averagePower)}
              </RNText>
            </View>
          ) : null}
          {!!activity.calories && (
            <View style={styles.secondaryStat}>
              <Icon
                name="food-apple"
                size={iconSize.sm}
                color={isDark ? darkColors.successText : colors.successText}
              />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatCalories(activity.calories)}
              </RNText>
            </View>
          )}
          {activity.hasWeather && activity.averageWeatherTemp != null ? (
            <View style={styles.secondaryStat}>
              <Icon name="weather-partly-cloudy" size={iconSize.sm} color={colors.actionLink} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatTemperature(activity.averageWeatherTemp, isMetric)}
              </RNText>
            </View>
          ) : null}
        </PressTarget>
      </ScrollView>
    );

    const sectionCounts = {
      prs: sectionHighlights?.filter((h) => h.isPr).length ?? 0,
      faster: sectionHighlights?.filter((h) => h.trend === 1 && !h.isPr).length ?? 0,
      slower: sectionHighlights?.filter((h) => h.trend === -1 && !h.isPr).length ?? 0,
    };

    const menuIsNative = contextMenuHoldIsNative();
    // The menu a hold opens wraps the card it belongs to, compact or full, and
    // offers map controls only on the card that draws a map.
    const withMenu = (card: React.ReactElement, hasMap: boolean) => {
      const menu = (
        <ActivityCardContextMenu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          activity={activity}
          hasMap={hasMap}
        >
          {card}
        </ActivityCardContextMenu>
      );
      if (!menuIsNative) return menu;
      return (
        <View>
          {menu}
          {/* An automation driver lists nothing drawn under the system menu's
              link, so the card's id is carried by an inert view over its frame. */}
          <View
            testID={`activity-card-${activity.id}`}
            style={cardContainers.idMarker}
            pointerEvents="none"
          />
        </View>
      );
    };
    const onHold = menuIsNative ? undefined : handleLongPress;
    const pressTargetId = menuIsNative ? undefined : `activity-card-${activity.id}`;

    // The feed reads every strength card's summary in one engine call and hands
    // each card its own.
    const isStrength = activity.sportType === 'WeightTraining';

    if (isStrength && strengthData) {
      return <StrengthActivityCard activity={activity} strengthData={strengthData} />;
    }

    const stats = cardPrimaryStats(activity, isMetric);
    const syncFailureChip = syncFailed ? (
      <ActivitySyncFailureChip
        activityId={activity.id}
        retrying={retryingSync}
        onRetry={retrySync}
      />
    ) : null;

    // Compact card for activities without GPS data
    if (!hasGpsData) {
      return withMenu(
        <View style={cardContainers.wrapper}>
          <PressTarget
            testID={pressTargetId}
            onPress={handlePress}
            onLongPress={onHold}
            delayLongPress={PREVIEW_HOLD_MS}
            accessibilityRole="button"
            accessibilityLabel={activityCardA11yLabel({ activity, isMetric }, t)}
            {...cardActions}
            ripple="over"
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
                    <Icon name={iconName} size={iconSize.sm} color={colors.textOnFill} />
                  </View>
                  <View style={styles.compactTitleColumn}>
                    <View style={styles.compactNameRow}>
                      <NameText style={[styles.compactName, { color: compactTextColor }]}>
                        {activity.name}
                      </NameText>
                      <Icon
                        name="map-marker-off"
                        size={iconSize.sm}
                        color={compactMutedColor}
                        style={styles.compactNoMapIcon}
                      />
                    </View>
                    <FitText style={[styles.compactDateSubtitle, { color: compactMutedColor }]}>
                      {formatRelativeDateTime(activity.startDateLocal)}
                    </FitText>
                    {syncFailureChip}
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
                {activity.skylineChartBytes ? (
                  <SkylineBar skylineBytes={activity.skylineChartBytes} isDark={isDark} />
                ) : (
                  <View style={[styles.dividerLine, { backgroundColor: compactDividerColor }]} />
                )}

                {/* Secondary stats */}
                {secondaryStatsRow(compactMutedColor)}
              </View>
            </Card>
          </PressTarget>
          <ActivityStubAction activityId={activity.id} verdict={activity.stub} />
        </View>,
        false
      );
    }

    // Past the dense cap the text outgrows any fixed box, so the name sits above
    // the map and the stats below it, on the card's own surface, and the card
    // grows with them. Below the cap both ride the full-bleed map over its scrims.
    const textTheme = largeText ? surfaceText : theme;
    const StatValue = largeText ? FitText : RNText;

    const cardLabel = activityCardA11yLabel(
      {
        activity,
        isMetric,
        sectionHighlights,
        routeHighlight,
      },
      t
    );

    const routeChip =
      routeHighlight && showsRouteChip ? (
        <PressTarget
          accessibilityRole="button"
          accessibilityLabel={composeAccessibilityLabel(
            t('activityDetail.tabs.route'),
            routeHighlight.routeName,
            routeChipSpeech(routeHighlight, t)
          )}
          testID={`activity-card-${activity.id}-route-chip`}
          onPress={() => openActivity('routes')}
          hitSlop={CHIP_SLOP}
          style={[styles.routeChip, largeText && styles.flowRouteChip]}
        >
          {routeHighlight.isPr ? (
            <Badge
              tone="record"
              icon="trophy"
              text={t('activity.prBadge')}
              isDark={isDark}
              testID={`activity-card-${activity.id}-route-badge`}
            />
          ) : routeHighlight.timeDeltaSeconds != null ? (
            <Badge
              tone="negative"
              text={formatPrGap(routeHighlight.timeDeltaSeconds)}
              isDark={isDark}
              testID={`activity-card-${activity.id}-route-badge`}
            />
          ) : null}
        </PressTarget>
      ) : null;

    // Sport icon + name/date stacked, with the route trend beside them over the
    // map and under them in flow.
    const header = (
      <>
        <View
          style={styles.overlayHeader}
          pointerEvents="box-none"
          testID={`activity-card-${activity.id}-title-row`}
        >
          <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
            <Icon name={iconName} size={iconSize.sm} color={colors.textOnFill} />
          </View>
          <View style={styles.overlayTitleColumn}>
            <NameText
              style={[
                styles.overlayName,
                { color: textTheme.text, textShadowColor: textTheme.shadow },
              ]}
            >
              {activity.name}
            </NameText>
            <FitText
              style={[
                styles.overlayDateSubtitle,
                { color: textTheme.textSecondary, textShadowColor: textTheme.shadow },
              ]}
            >
              {formatRelativeDateTime(activity.startDateLocal)}
            </FitText>
            {syncFailureChip}
          </View>
          {largeText ? null : routeChip}
        </View>
        {largeText ? routeChip : null}
      </>
    );

    // All stats unified: the primary row, the zone strip and the secondary row.
    const statsBlock = (
      <>
        {/* Primary stats: a second touch area for the card's own press,
              spoken in the card's label. The section chip inside is
              reached through the card's actions. */}
        <PressTarget
          accessible={false}
          accessibilityRole="none"
          onPress={handlePress}
          style={[styles.primaryRow, largeText && styles.flowPrimaryRow]}
        >
          <View
            style={[styles.primaryStats, largeText && styles.flowPrimaryStats]}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {stats.distance != null && (
              <>
                <StatValue
                  testID={`activity-card-${activity.id}-distance`}
                  style={[
                    styles.primaryStatValue,
                    { color: textTheme.text, textShadowColor: textTheme.shadow },
                  ]}
                >
                  {stats.distance}
                </StatValue>
                <RNText style={[styles.statDot, { color: textTheme.dot }]}>·</RNText>
              </>
            )}
            <StatValue
              testID={`activity-card-${activity.id}-duration`}
              style={[
                styles.primaryStatValue,
                { color: textTheme.text, textShadowColor: textTheme.shadow },
              ]}
            >
              {stats.duration}
            </StatValue>
            {stats.elevation != null && (
              <>
                <RNText style={[styles.statDot, { color: textTheme.dot }]}>·</RNText>
                <StatValue
                  testID={`activity-card-${activity.id}-elevation`}
                  style={[
                    styles.primaryStatValue,
                    { color: textTheme.text, textShadowColor: textTheme.shadow },
                  ]}
                >
                  {stats.elevation}
                </StatValue>
              </>
            )}
          </View>
          {/* Right column: section trend indicators + PR counts. */}
          {showsSectionChip ? (
            <View style={[styles.rightColumn, largeText && styles.flowRightColumn]}>
              {sectionHighlights && showsSectionChip ? (
                <PressTarget
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
                  style={styles.trendBadge}
                >
                  {(() => {
                    const { faster: improving, slower: declining, prs: prCount } = sectionCounts;
                    return (
                      <>
                        {prCount > 0 && (
                          <Badge
                            tone="record"
                            icon="trophy"
                            text={prCount}
                            isDark={isDark}
                            testID={`activity-card-${activity.id}-pr-pill`}
                          />
                        )}
                        {improving > 0 && (
                          <Badge
                            tone="positive"
                            icon="trending-up"
                            text={improving}
                            isDark={isDark}
                            testID={`activity-card-${activity.id}-improving-pill`}
                          />
                        )}
                        {declining > 0 && (
                          <Badge
                            tone="negative"
                            icon="trending-down"
                            text={declining}
                            isDark={isDark}
                            testID={`activity-card-${activity.id}-declining-pill`}
                          />
                        )}
                      </>
                    );
                  })()}
                </PressTarget>
              ) : null}
            </View>
          ) : null}
        </PressTarget>
        {activity.skylineChartBytes ? (
          <SkylineBar skylineBytes={activity.skylineChartBytes} isDark={isDark} />
        ) : (
          <View style={[styles.dividerLine, { backgroundColor: textTheme.divider }]} />
        )}
        {secondaryStatsRow(textTheme.secondaryText)}
      </>
    );

    const mapPreview = (
      <ActivityMapPreview
        activity={activity}
        height={CARD_HEIGHT}
        index={index}
        snapshotRef={snapshotRef}
        snapshotReady={snapshotReady}
        startupTrack={startupTrack}
      />
    );

    // Tap and hold for the whole card. The name and the stats sit above it so
    // their own chips take the tap, and a press anywhere else lands here.
    const pressOverlay = (
      <PressTarget
        testID={pressTargetId}
        onPress={handlePress}
        onLongPress={onHold}
        delayLongPress={PREVIEW_HOLD_MS}
        style={styles.pressableOverlay}
        accessibilityRole="button"
        accessibilityLabel={cardLabel}
        {...cardActions}
      />
    );

    if (largeText) {
      return withMenu(
        <View style={cardContainers.wrapper}>
          <Card variant="raised" padding="none" testID={`activity-card-${activity.id}-container`}>
            <View style={styles.flowContainer}>
              {pressOverlay}
              {/* Read through the overlay's label and actions, so the name is heard once. */}
              <View
                testID={`activity-card-${activity.id}-header`}
                style={styles.flowHeader}
                pointerEvents="box-none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {header}
              </View>
              <View style={styles.flowMap}>{mapPreview}</View>
              <View
                testID="activity-card-bottom"
                style={styles.flowBottom}
                pointerEvents="box-none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {statsBlock}
              </View>
            </View>
          </Card>
        </View>,
        true
      );
    }

    return withMenu(
      <View style={cardContainers.wrapper}>
        <Card variant="raised" padding="none" testID={`activity-card-${activity.id}-container`}>
          <View style={cardContainers.map}>
            {mapPreview}
            {pressOverlay}

            {/* Top gradient. Read through the overlay's label and actions, so
                the name is heard once. */}
            <LinearGradient
              testID={`activity-card-${activity.id}-header`}
              colors={theme.top as [string, string, string]}
              style={styles.topOverlay}
              pointerEvents="box-none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {header}
            </LinearGradient>

            <View
              testID="activity-card-bottom"
              style={styles.bottomSection}
              pointerEvents="box-none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <LinearGradient
                colors={theme.bottom as [string, string, string]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              {statsBlock}
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
          next.strengthData,
        ],
      }
    )
);

// The chips sit on the card, which is its own press target, so the slop only
// lifts their height and leaves the card's area beside them alone.
const CHIP_SLOP = slopToMinTapTarget(BADGE_HEIGHT.md);

// The header and footer sit over the press overlay so their own controls take
// the tap. The layer scale has no rung between raised and sticky.
const ABOVE_PRESS_OVERLAY = layers.raised + 1;

const styles = StyleSheet.create({
  // Past the dense cap: name, map and stats stacked in the card's flow.
  flowContainer: {
    position: 'relative',
  },
  flowHeader: {
    paddingTop: spacing.smPlus,
    paddingHorizontal: spacing.smPlus,
    paddingBottom: spacing.sm,
    zIndex: ABOVE_PRESS_OVERLAY,
  },
  flowMap: {
    height: CARD_HEIGHT,
  },
  flowBottom: {
    paddingTop: spacing.xs,
    zIndex: ABOVE_PRESS_OVERLAY,
  },
  flowRouteChip: {
    alignSelf: 'flex-start',
    marginLeft: 0,
    marginTop: spacing.xs,
  },
  flowPrimaryRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingTop: 0,
  },
  flowPrimaryStats: {
    flexWrap: 'wrap',
  },
  flowRightColumn: {
    alignItems: 'flex-start',
    marginLeft: 0,
    marginTop: spacing.xxs,
  },
  pressableOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: layers.raised,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.smPlus,
    paddingHorizontal: spacing.smPlus,
    paddingBottom: spacing.lg,
    zIndex: ABOVE_PRESS_OVERLAY,
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
  // The title column gives up the width, so the chip's time is never cut.
  routeChip: {
    marginLeft: spacing.sm,
    flexShrink: 0,
  },
  overlayName: {
    ...typography.cardTitle,
    ...mapTextShadow,
  },
  overlayDateSubtitle: {
    ...typography.caption,
    marginTop: spacing.xxs,
    ...mapTextShadow,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: ABOVE_PRESS_OVERLAY,
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
  primaryStats: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  primaryStatValue: {
    ...typography.bodyBold,
    ...mapTextShadow,
  },
  statDot: {
    ...typography.cardTitle,
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
    ...typography.captionBold,
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
    ...typography.cardTitle,
    flex: 1,
    letterSpacing: -0.3,
  },
  compactNoMapIcon: {
    marginLeft: spacing.xsPlus,
  },
  compactDateSubtitle: {
    ...typography.caption,
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
    ...typography.bodyBold,
    letterSpacing: -0.3,
  },
});
