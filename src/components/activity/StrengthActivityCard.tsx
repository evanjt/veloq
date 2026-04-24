import React, { useState, useCallback, useRef } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Platform, Text as RNText } from 'react-native';
import { useTheme, useMetricSystem } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import type { Activity } from '@/types';
import {
  formatDuration,
  formatRelativeDate,
  formatTSS,
  formatHeartRate,
  formatPower,
  formatCalories,
  formatTemperature,
  getActivityIcon,
  getActivityColor,
} from '@/lib';
import { colors, darkColors, typography, spacing, shadows, brand, layout } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { ActivityCardContextMenu } from './ActivityCardContextMenu';
import { SkylineBar } from './SkylineBar';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';

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
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const [menuVisible, setMenuVisible] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);

  const handlePress = useCallback(() => {
    router.push(`/activity/${activity.id}`);
  }, [activity.id]);

  const handleLongPress = useCallback(() => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setMenuVisible(true);
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const hasFlashed = useRef(false);

  const handleContentSizeChange = useCallback((contentWidth: number, _contentHeight: number) => {
    if (!hasFlashed.current && scrollRef.current) {
      hasFlashed.current = true;
      setTimeout(() => scrollRef.current?.flashScrollIndicators(), 400);
    }
  }, []);

  const activityColor = getActivityColor(activity.type);
  const iconName = getActivityIcon(activity.type);

  const compactTextColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const compactMutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const compactDividerColor = isDark ? darkColors.border : 'rgba(0,0,0,0.1)';

  const secondaryStatsRow = (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={handleContentSizeChange}
      style={styles.secondaryScroll}
    >
      <Pressable onPress={handlePress} style={styles.secondaryStats}>
        {!!activity.icu_training_load && (
          <View
            style={styles.secondaryStat}
            accessibilityLabel={`${t('activity.stats.trainingLoad')}: ${formatTSS(activity.icu_training_load)}`}
          >
            <MaterialCommunityIcons name="fire" size={14} color={colors.primary} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatTSS(activity.icu_training_load)}
            </RNText>
          </View>
        )}
        {!!(activity.average_heartrate || activity.icu_average_hr) && (
          <View
            style={styles.secondaryStat}
            accessibilityLabel={`${t('activity.heartRate')}: ${formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)} ${t('units.bpm')}`}
          >
            <MaterialCommunityIcons name="heart-pulse" size={14} color={colors.error} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
            </RNText>
          </View>
        )}
        {!!(activity.average_watts || activity.icu_average_watts) && (
          <View
            style={styles.secondaryStat}
            accessibilityLabel={`${t('activity.power')}: ${formatPower(activity.average_watts || activity.icu_average_watts!)} ${t('units.watts')}`}
          >
            <MaterialCommunityIcons name="lightning-bolt" size={14} color={colors.warning} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatPower(activity.average_watts || activity.icu_average_watts!)}
            </RNText>
          </View>
        )}
        {!!activity.calories && (
          <View
            style={styles.secondaryStat}
            accessibilityLabel={`${t('activity.calories')}: ${formatCalories(activity.calories)} ${t('units.kcal')}`}
          >
            <MaterialCommunityIcons name="food-apple" size={14} color={colors.success} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatCalories(activity.calories)}
            </RNText>
          </View>
        )}
        {activity.has_weather && activity.average_weather_temp != null && (
          <View
            style={styles.secondaryStat}
            accessibilityLabel={`${t('activity.stats.temperature')}: ${formatTemperature(activity.average_weather_temp, isMetric)}`}
          >
            <MaterialCommunityIcons name="weather-partly-cloudy" size={14} color={colors.info} />
            <RNText style={[styles.secondaryStatValue, { color: compactMutedColor }]}>
              {formatTemperature(activity.average_weather_temp, isMetric)}
            </RNText>
          </View>
        )}
      </Pressable>
    </ScrollView>
  );

  return (
    <View style={styles.cardWrapper}>
      <View style={[styles.card, isDark && styles.cardDark, isPressed && styles.cardPressed]}>
        <View style={[styles.strengthPanel, isDark && styles.strengthPanelDark]}>
          {/* Pressable overlay */}
          <Pressable
            testID={`activity-card-${activity.id}`}
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={styles.pressableOverlay}
            accessibilityRole="button"
            accessibilityLabel={`${activity.name}, ${formatRelativeDate(activity.start_date_local)}, ${formatDuration(activity.moving_time)}`}
          />

          {/* Top: icon + name + date */}
          <View style={styles.topOverlay} pointerEvents="none">
            <View style={styles.overlayHeader}>
              <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                <MaterialCommunityIcons name={iconName} size={14} color={colors.textOnDark} />
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
                  {formatRelativeDate(activity.start_date_local)}
                </RNText>
              </View>
            </View>
          </View>

          {/* Center: body diagrams + stats */}
          <View style={styles.strengthCenter}>
            <View style={styles.strengthBodies}>
              <Body
                data={strengthData.muscles}
                gender="male"
                side="front"
                scale={0.38}
                colors={[brand.orangeLight, brand.orange]}
              />
              <Body
                data={strengthData.muscles}
                gender="male"
                side="back"
                scale={0.38}
                colors={[brand.orangeLight, brand.orange]}
              />
            </View>
            <View style={styles.strengthStats}>
              <View style={styles.strengthStatRow}>
                <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                  {formatDuration(activity.moving_time)}
                </RNText>
                <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                  Duration
                </RNText>
              </View>
              <View style={styles.strengthStatRow}>
                <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                  {strengthData.exerciseCount} / {strengthData.setCount}
                </RNText>
                <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                  {t('activityDetail.exercises')} / Sets
                </RNText>
              </View>
              {strengthData.totalWeight > 0 && (
                <View style={styles.strengthStatRow}>
                  <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                    {isMetric
                      ? `${Math.round(strengthData.totalWeight)} kg`
                      : `${Math.round(strengthData.totalWeight * 2.20462)} lbs`}
                  </RNText>
                  <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                    Total
                  </RNText>
                </View>
              )}
            </View>
          </View>

          {/* Bottom: secondary stats only */}
          <View style={styles.strengthBottom}>
            {activity.skyline_chart_bytes ? (
              <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
            ) : (
              <View style={[styles.dividerLine, { backgroundColor: compactDividerColor }]} />
            )}
            {secondaryStatsRow}
          </View>
        </View>
      </View>
      <ActivityCardContextMenu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        activity={activity}
      />
    </View>
  );
}

export const StrengthActivityCard = React.memo(StrengthActivityCardInner);

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: 12,
    marginBottom: 12,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  card: {
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadows.elevated,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
    borderWidth: 1,
    borderColor: darkColors.border,
    ...shadows.modal,
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
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  strengthBodies: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  strengthStats: {
    gap: 10,
  },
  strengthStatRow: {},
  strengthStatValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  strengthStatLabel: {
    fontSize: 10,
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
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 28,
    zIndex: 2,
  },
  overlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTitleColumn: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  overlayName: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    letterSpacing: -0.3,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  overlayDateSubtitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    marginTop: 1,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  dividerLine: {
    height: 1,
    marginHorizontal: 12,
  },
  secondaryScroll: {
    paddingTop: 2,
    paddingBottom: 8,
  },
  secondaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 12,
  },
  secondaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  secondaryStatValue: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
});
