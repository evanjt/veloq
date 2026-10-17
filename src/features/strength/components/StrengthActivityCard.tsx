import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Text as RNText } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as haptics from '@/shared/ui/haptics';
import { useTranslation } from 'react-i18next';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';

import { useTheme, useMetricSystem, useAthlete } from '@/shared/app';
import type { Activity } from '@/types';
import {
  ActivityCardContextMenu,
  SkylineBar,
  activitySecondaryStatLabels,
} from '@/features/activity';
import { getActivityIcon, getActivityColor } from '@/shared/activity/activityUtils';
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
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layout,
  mapTextShadow,
  spacing,
  typography,
} from '@/theme';
import { formatWeightRounded } from '@/shared/format/weight';
import { spokenDuration } from '@/shared/format/spoken';
import { accessibleActions, composeAccessibilityLabel, pressable, pressRipple } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { contextMenuHoldIsNative } from '@/shared/ui/ContextMenu';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';
import { tapTo } from '@/shared/app/navigation';

/** Aggregated muscle/exercise data for a strength activity */
export interface StrengthCardData {
  muscles: ExtendedBodyPart[];
  exerciseCount: number;
  setCount: number;
  /** Total weight lifted (kg). 0 if no weight data. */
  totalWeight: number;
}

interface StrengthActivityCardProps {
  activity: Activity;
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
  const isMetric = useMetricSystem();
  const [menuVisible, setMenuVisible] = useState(false);
  const averageHeartRate = activity.average_heartrate;
  const averagePower = activity.icu_average_watts;

  const handlePress = useCallback(() => {
    tapTo(`/activity/${activity.id}`);
  }, [activity.id]);

  const handleLongPress = useCallback(() => {
    haptics.medium();
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

  const scrollRef = useRef<ScrollView>(null);
  const hasFlashed = useRef(false);

  const handleContentSizeChange = useCallback((_contentWidth: number, _contentHeight: number) => {
    if (!hasFlashed.current && scrollRef.current) {
      hasFlashed.current = true;
      setTimeout(() => scrollRef.current?.flashScrollIndicators(), 400);
    }
  }, []);

  const activityColor = getActivityColor(activity.type);
  const iconName = getActivityIcon(activity.type);

  const compactTextColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const compactMutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const compactDividerColor = isDark ? darkColors.border : colorWithOpacity(ink.black, 0.1);

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
      <Pressable
        onPress={handlePress}
        accessible={false}
        accessibilityRole="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={pressable(styles.secondaryStats)}
        android_ripple={pressRipple}
      >
        {!!activity.icu_training_load && (
          <View style={styles.secondaryStat}>
            <MaterialCommunityIcons name="fire" size={iconSize.sm} color={colors.primary} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatLoad(activity.icu_training_load)}
            </RNText>
          </View>
        )}
        {averageHeartRate ? (
          <View style={styles.secondaryStat}>
            <MaterialCommunityIcons name="heart-pulse" size={iconSize.sm} color={colors.error} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatHeartRate(averageHeartRate)}
            </RNText>
          </View>
        ) : null}
        {averagePower ? (
          <View style={styles.secondaryStat}>
            <MaterialCommunityIcons
              name="lightning-bolt"
              size={iconSize.sm}
              color={isDark ? darkColors.warningAmber : colors.warningAmber}
            />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatPower(averagePower)}
            </RNText>
          </View>
        ) : null}
        {!!activity.calories && (
          <View style={styles.secondaryStat}>
            <MaterialCommunityIcons
              name="food-apple"
              size={iconSize.sm}
              color={isDark ? darkColors.successDeep : colors.successDeep}
            />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatCalories(activity.calories)}
            </RNText>
          </View>
        )}
        {activity.has_weather && activity.average_weather_temp != null ? (
          <View style={styles.secondaryStat}>
            <MaterialCommunityIcons
              name="weather-partly-cloudy"
              size={iconSize.sm}
              color={colors.info}
            />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatTemperature(activity.average_weather_temp, isMetric)}
            </RNText>
          </View>
        ) : null}
      </Pressable>
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
          <View style={[styles.strengthPanel, isDark && styles.strengthPanelDark]}>
            {/* Pressable overlay */}
            <Pressable
              testID={`activity-card-${activity.id}`}
              onPress={handlePress}
              onLongPress={contextMenuHoldIsNative() ? undefined : handleLongPress}
              delayLongPress={PREVIEW_HOLD_MS}
              style={pressable(styles.pressableOverlay)}
              android_ripple={pressRipple}
              accessibilityRole="button"
              accessibilityLabel={composeAccessibilityLabel(
                activity.name,
                formatRelativeDateTime(activity.start_date_local),
                `${t('strength.durationLabel')}: ${spokenDuration(activity.moving_time)}`,
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
              style={styles.topOverlay}
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <View style={styles.overlayHeader}>
                <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                  <MaterialCommunityIcons
                    name={iconName}
                    size={iconSize.sm}
                    color={colors.textOnDark}
                  />
                </View>
                <View style={styles.overlayTitleColumn}>
                  <RNText
                    style={[
                      styles.overlayName,
                      { color: compactTextColor, textShadowColor: 'transparent' },
                    ]}
                    numberOfLines={1}
                  >
                    {activity.name}
                  </RNText>
                  <RNText
                    style={[
                      styles.overlayDateSubtitle,
                      { color: compactMutedColor, textShadowColor: 'transparent' },
                    ]}
                  >
                    {formatRelativeDateTime(activity.start_date_local)}
                  </RNText>
                </View>
              </View>
            </View>

            {/* Center: body diagrams + stats */}
            <View
              style={styles.strengthCenter}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <View style={styles.strengthBodies}>
                <Body
                  data={strengthData.muscles}
                  gender={bodyGender}
                  side="front"
                  scale={0.38}
                  colors={[brand.tealDark, brand.tealLight]}
                />
                <Body
                  data={strengthData.muscles}
                  gender={bodyGender}
                  side="back"
                  scale={0.38}
                  colors={[brand.tealDark, brand.tealLight]}
                />
              </View>
              <View style={styles.strengthStats}>
                <View style={styles.strengthStatRow}>
                  <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                    {formatDuration(activity.moving_time)}
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
              style={styles.strengthBottom}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {activity.skyline_chart_bytes ? (
                <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
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

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: spacing.smPlus,
    marginBottom: spacing.smPlus,
  },
  strengthPanel: {
    position: 'relative',
    height: 240,
    backgroundColor: colors.gray100,
  },
  strengthPanelDark: {
    backgroundColor: darkColors.backgroundAlt,
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
    fontSize: typography.body.fontSize,
    fontWeight: '700',
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
