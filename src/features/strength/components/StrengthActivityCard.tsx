import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Text as RNText,
  type ScrollViewInstance,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';

import { useTheme, useMetricSystem, useAthlete } from '@/shared/app';
import type { ActivityType, FeedCard } from '@/types';
import {
  ActivityCardContextMenu,
  SkylineBar,
  activitySecondaryStatLabels,
} from '@/features/activity';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import {
  formatDuration,
  formatRelativeDateTime,
  formatLoad,
  formatHeartRate,
  formatPower,
  formatCalories,
  formatTemperature,
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
  spacing,
  typography,
  themePalette,
  opacity,
} from '@/theme';
import { formatWeightRounded } from '@/shared/format/weight';
import { spokenDuration } from '@/shared/format/spoken';
import {
  accessibleActions,
  composeAccessibilityLabel,
  useLargeText,
  PressTarget,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { Card } from '@/shared/ui/Card';
import { contextMenuHoldIsNative } from '@/shared/ui/ContextMenu';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';
import { navigateTo } from '@/shared/app/navigation';
import { NameText } from '@/shared/ui/NameText';
import { StrengthCardBodies } from './StrengthCardBodies';

/** Aggregated muscle/exercise data for a strength activity */
export interface StrengthCardData {
  muscles: ExtendedBodyPart[];
  exerciseCount: number;
  setCount: number;
  /** Total weight lifted (kg). 0 if no weight data. */
  totalWeight: number;
}

interface StrengthActivityCardProps {
  activity: FeedCard;
  strengthData: StrengthCardData;
}

/**
 * Card variant for WeightTraining activities.
 * Displays muscle-group body diagram, exercise/set counts, and total weight.
 *
 * Rendered by ActivityCard when the activity is a WeightTraining type AND
 * strength data has loaded. Otherwise ActivityCard falls back to the default
 * compact/map card variants.
 */
function StrengthActivityCardInner({ activity, strengthData }: StrengthActivityCardProps) {
  const { t } = useTranslation();
  const { data: athlete } = useAthlete();
  const bodyGender = athlete?.sex === 'F' ? 'female' : 'male';
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const isMetric = useMetricSystem();
  const [menuVisible, setMenuVisible] = useState(false);
  // Past the dense cap the text outgrows the fixed panel, so the name, the
  // diagram and the stats stack in flow and the panel grows with them.
  const largeText = useLargeText();
  const averageHeartRate = activity.avgHr;
  const averagePower = activity.avgPower;

  const handlePress = useCallback(() => {
    navigateTo(`/activity/${activity.id}`);
  }, [activity.id]);

  const handleLongPress = useCallback(() => {
    setMenuVisible(true);
  }, []);

  // The hold sits inside the card's one element, so a screen reader reaches it here.
  const cardActions = useMemo(
    () =>
      accessibleActions([
        { name: 'longpress', label: t('activity.moreActions'), run: handleLongPress },
      ]),
    [handleLongPress, t]
  );

  const scrollRef = useRef<ScrollViewInstance>(null);
  const hasFlashed = useRef(false);

  const handleContentSizeChange = useCallback((_contentWidth: number, _contentHeight: number) => {
    if (!hasFlashed.current && scrollRef.current) {
      hasFlashed.current = true;
      setTimeout(() => scrollRef.current?.flashScrollIndicators(), 400);
    }
  }, []);

  // A body with no sport falls back to Other in every helper, as it always has.
  const sport = activity.sportType as ActivityType;
  const activityColor = sportMarkColour(sport, isDark);
  const iconName = getActivityIcon(sport);

  const compactTextColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const compactMutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const compactDividerColor = isDark
    ? darkColors.border
    : colorWithOpacity(ink.black, opacity.tint2);

  const secondaryStatsRow = (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={handleContentSizeChange}
      style={styles.secondaryScroll}
    >
      {/* A second touch area for the card's own press. The card's label speaks
          these stats, so a screen reader never reaches this. */}
      <PressTarget
        onPress={handlePress}
        accessible={false}
        accessibilityRole="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={styles.secondaryStats}
      >
        {!!activity.trainingLoad && (
          <View style={styles.secondaryStat}>
            <Icon name="fire" size={iconSize.sm} color={palette.actionPrimary} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatLoad(activity.trainingLoad)}
            </RNText>
          </View>
        )}
        {averageHeartRate ? (
          <View style={styles.secondaryStat}>
            <Icon name="heart-pulse" size={iconSize.sm} color={colors.errorText} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
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
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
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
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatCalories(activity.calories)}
            </RNText>
          </View>
        )}
        {activity.hasWeather && activity.averageWeatherTemp != null ? (
          <View style={styles.secondaryStat}>
            <Icon name="weather-partly-cloudy" size={iconSize.sm} color={colors.actionLink} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatTemperature(activity.averageWeatherTemp, isMetric)}
            </RNText>
          </View>
        ) : null}
      </PressTarget>
    </ScrollView>
  );

  return (
    <ActivityCardContextMenu
      visible={menuVisible}
      onDismiss={() => setMenuVisible(false)}
      activity={activity}
      hasMap={false}
    >
      <View style={styles.cardWrapper}>
        <Card variant="raised" padding="none">
          <View
            style={[
              largeText ? styles.flowPanel : styles.strengthPanel,
              isDark && styles.strengthPanelDark,
            ]}
          >
            {/* Press overlay */}
            <PressTarget
              testID={`activity-card-${activity.id}`}
              onPress={handlePress}
              onLongPress={contextMenuHoldIsNative() ? undefined : handleLongPress}
              delayLongPress={PREVIEW_HOLD_MS}
              style={styles.pressableOverlay}
              accessibilityRole="button"
              accessibilityLabel={composeAccessibilityLabel(
                activity.name,
                formatRelativeDateTime(activity.startDateLocal),
                `${t('strength.durationLabel')}: ${spokenDuration(activity.movingTime)}`,
                `${t('activityDetail.exercises')}: ${strengthData.exerciseCount}`,
                `${t('strength.setsLabel')}: ${strengthData.setCount}`,
                strengthData.totalWeight > 0 &&
                  `${t('strength.totalLabel')}: ${formatWeightRounded(strengthData.totalWeight, isMetric)}`,
                ...activitySecondaryStatLabels(activity, isMetric, t)
              )}
              {...cardActions}
            />

            {/* Top: icon + name + date */}
            <View
              testID={`activity-card-${activity.id}-header`}
              style={largeText ? styles.flowHeader : styles.topOverlay}
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <View style={styles.overlayHeader}>
                <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                  <Icon name={iconName} size={iconSize.sm} color={colors.textOnFill} />
                </View>
                <View style={styles.overlayTitleColumn}>
                  <NameText
                    style={[
                      styles.overlayName,
                      { color: compactTextColor, textShadowColor: 'transparent' },
                    ]}
                  >
                    {activity.name}
                  </NameText>
                  <RNText
                    style={[
                      styles.overlayDateSubtitle,
                      { color: compactMutedColor, textShadowColor: 'transparent' },
                    ]}
                  >
                    {formatRelativeDateTime(activity.startDateLocal)}
                  </RNText>
                </View>
              </View>
            </View>

            {/* Center: body diagrams + stats */}
            <View
              style={largeText ? styles.flowCenter : styles.strengthCenter}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <View style={styles.strengthBodies}>
                <StrengthCardBodies
                  testID={`activity-card-${activity.id}-bodies`}
                  muscles={strengthData.muscles}
                  gender={bodyGender}
                  scale={0.38}
                />
              </View>
              <View style={styles.strengthStats}>
                <View style={styles.strengthStatRow}>
                  <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                    {formatDuration(activity.movingTime ?? NaN)}
                  </RNText>
                  <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                    {t('strength.durationLabel')}
                  </RNText>
                </View>
                <View style={styles.strengthStatRow}>
                  <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                    {strengthData.exerciseCount} / {strengthData.setCount}
                  </RNText>
                  <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                    {t('activityDetail.exercises')} / {t('strength.setsLabel')}
                  </RNText>
                </View>
                {strengthData.totalWeight > 0 && (
                  <View style={styles.strengthStatRow}>
                    <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                      {formatWeightRounded(strengthData.totalWeight, isMetric)}
                    </RNText>
                    <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                      {t('strength.totalLabel')}
                    </RNText>
                  </View>
                )}
              </View>
            </View>

            {/* Bottom: secondary stats only. Its press opens the activity the
              overlay already opens, so it is not a second stop. */}
            <View
              testID={`activity-card-${activity.id}-bottom`}
              style={largeText ? undefined : styles.strengthBottom}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {activity.skylineChartBytes ? (
                <SkylineBar skylineBytes={activity.skylineChartBytes} isDark={isDark} />
              ) : (
                <View style={[styles.dividerLine, { backgroundColor: compactDividerColor }]} />
              )}
              {secondaryStatsRow}
            </View>
          </View>
        </Card>
      </View>
    </ActivityCardContextMenu>
  );
}

export const StrengthActivityCard = React.memo(StrengthActivityCardInner);

// The header sits over the press overlay so its own controls take the tap.
// The layer scale has no rung between raised and sticky.
const ABOVE_PRESS_OVERLAY = layers.raised + 1;

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: spacing.smPlus,
    marginBottom: spacing.smPlus,
  },
  strengthPanel: {
    position: 'relative',
    height: 240,
    backgroundColor: colors.fillNeutral,
  },
  flowPanel: {
    backgroundColor: colors.fillNeutral,
  },
  flowHeader: {
    paddingTop: spacing.smPlus,
    paddingHorizontal: spacing.smPlus,
    paddingBottom: spacing.sm,
    zIndex: ABOVE_PRESS_OVERLAY,
  },
  flowCenter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.smPlus,
    paddingVertical: spacing.sm,
  },
  strengthPanelDark: {
    backgroundColor: darkColors.surfaceInput,
  },
  strengthCenter: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.smPlus,
  },
  strengthBodies: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  strengthStats: {
    gap: spacing.sm,
  },
  strengthStatRow: {},
  strengthStatValue: {
    ...typography.bodyBold,
  },
  strengthStatLabel: {
    fontSize: typography.micro.fontSize,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  strengthBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
  overlayName: {
    ...typography.cardTitle,
    ...mapTextShadow,
  },
  overlayDateSubtitle: {
    ...typography.caption,
    marginTop: spacing.xxs,
    ...mapTextShadow,
  },
  dividerLine: {
    height: 1,
    marginHorizontal: spacing.smPlus,
  },
  secondaryScroll: {
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
});
