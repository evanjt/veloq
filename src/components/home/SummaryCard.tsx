import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, shadows, opacity } from '@/theme';
import { SummaryCardSparkline } from './SummaryCardSparkline';

/**
 * Supporting metric displayed in the bottom row of SummaryCard
 */
interface SupportingMetric {
  label: string;
  value: string | number;
  color?: string;
  trend?: '↑' | '↓' | '';
  navigationTarget?: '/fitness' | '/training';
}

/**
 * Props for the SummaryCard component
 */
export interface SummaryCardProps {
  // Profile
  profileUrl?: string;
  onProfilePress: () => void;

  // Hero metric data
  heroValue: number | string;
  heroLabel: string; // "Form", "Fitness", etc.
  heroColor: string;
  heroZoneLabel?: string; // "Fresh", "Tired", etc.
  heroZoneColor?: string;
  heroTrend?: '↑' | '↓' | '';
  onHeroPress?: () => void;

  // Accent bar color (form zone color)
  accentColor?: string;

  // Sparkline data (30 days)
  sparklineData?: number[];
  showSparkline: boolean;

  // Supporting metrics (max 4)
  supportingMetrics: SupportingMetric[];
}

/**
 * Summary card for the home screen hero section.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────┐
 * │  [👤⚙]   +13  Form · Fresh                              │
 * │                                                          │
 * │  ▁▂▃▅▇▆▅▃▂▁▂▃▅▆▇▅▃▂▁▃▅▆▇▆▅▃▂▁  30d                   │
 * │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
 * │                                                          │
 * │  Fitness 26↓  ·  FTP 155  ·  Week 1.6h  ·  Weight 72kg │
 * └──────────────────────────────────────────────────────────┘
 */
export const SummaryCard = React.memo(function SummaryCard({
  profileUrl,
  onProfilePress,
  heroValue,
  heroLabel,
  heroColor,
  heroZoneLabel,
  heroZoneColor,
  heroTrend,
  onHeroPress,
  accentColor,
  sparklineData,
  showSparkline,
  supportingMetrics,
}: SummaryCardProps) {
  const { isDark, colors: themeColors } = useTheme();
  const [profileImageError, setProfileImageError] = React.useState(false);

  // Validate profile URL - must be a non-empty string starting with http
  const hasValidProfileUrl =
    profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

  // Format hero value with sign for positive numbers
  const formattedHeroValue =
    typeof heroValue === 'number' && heroValue > 0 ? `+${heroValue}` : String(heroValue);

  const resolvedAccentColor = accentColor || heroZoneColor || heroColor;

  // Compute explicit sparkline width (screen minus card margins and padding)
  const sparklineWidth = Dimensions.get('window').width - layout.screenPadding * 2 - spacing.md * 2;

  return (
    <View style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
      {/* Top row: Profile + Hero value + zone */}
      <View style={styles.topRow}>
        {/* Profile photo with gear badge */}
        <TouchableOpacity
          onPress={onProfilePress}
          activeOpacity={0.7}
          style={styles.profileTouchArea}
          accessibilityLabel="Open settings"
          accessibilityRole="button"
        >
          <View style={[styles.profilePhoto, isDark && styles.profilePhotoDark]}>
            {hasValidProfileUrl && !profileImageError ? (
              <Image
                source={{ uri: profileUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onError={() => setProfileImageError(true)}
              />
            ) : (
              <MaterialCommunityIcons name="account" size={22} color={themeColors.textSecondary} />
            )}
          </View>
          {/* Gear badge */}
          <View style={[styles.gearBadge, isDark && styles.gearBadgeDark]}>
            <MaterialCommunityIcons
              name="cog"
              size={10}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          </View>
        </TouchableOpacity>

        {/* Hero metric - tappable */}
        <TouchableOpacity
          style={styles.heroSection}
          onPress={onHeroPress}
          disabled={!onHeroPress}
          activeOpacity={onHeroPress ? 0.7 : 1}
        >
          <View style={styles.heroValueRow}>
            <Text style={[styles.heroValue, { color: heroColor }]}>
              {formattedHeroValue}
              {heroTrend && <Text style={styles.heroTrend}>{heroTrend}</Text>}
            </Text>
            <Text style={[styles.heroLabel, isDark && styles.textSecondary]}>{heroLabel}</Text>
            {heroZoneLabel && (
              <>
                <View style={[styles.zoneDot, { backgroundColor: heroZoneColor || heroColor }]} />
                <Text style={[styles.zoneLabel, { color: heroZoneColor || heroColor }]}>
                  {heroZoneLabel}
                </Text>
              </>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Sparkline row — wide, tappable along with hero */}
      {showSparkline && sparklineData && sparklineData.length > 0 && (
        <TouchableOpacity
          onPress={onHeroPress}
          disabled={!onHeroPress}
          activeOpacity={onHeroPress ? 0.7 : 1}
          style={styles.sparklineRow}
        >
          <SummaryCardSparkline
            data={sparklineData}
            color={heroColor}
            width={sparklineWidth}
            height={44}
            label="30d"
          />
        </TouchableOpacity>
      )}

      {/* Accent bar — thin form-zone-colored bar */}
      <View style={[styles.accentBar, { backgroundColor: resolvedAccentColor }]} />

      {/* Supporting metrics row — each metric tappable */}
      <View style={styles.supportingRow}>
        {supportingMetrics.slice(0, 4).map((metric, index) => (
          <React.Fragment key={metric.label}>
            {index > 0 && (
              <Text style={[styles.metricDivider, isDark && styles.metricDividerDark]}>
                {'\u00B7'}
              </Text>
            )}
            {metric.navigationTarget ? (
              <TouchableOpacity
                style={styles.supportingMetric}
                onPress={() => router.push(metric.navigationTarget as Href)}
                activeOpacity={0.7}
              >
                <Text style={[styles.metricLabel, isDark && styles.textMuted]}>{metric.label}</Text>
                <Text
                  style={[
                    styles.metricValue,
                    {
                      color: metric.color || (isDark ? darkColors.textPrimary : colors.textPrimary),
                    },
                  ]}
                >
                  {metric.value}
                  {metric.trend && <Text style={styles.metricTrend}>{metric.trend}</Text>}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.supportingMetric}>
                <Text style={[styles.metricLabel, isDark && styles.textMuted]}>{metric.label}</Text>
                <Text
                  style={[
                    styles.metricValue,
                    {
                      color: metric.color || (isDark ? darkColors.textPrimary : colors.textPrimary),
                    },
                  ]}
                >
                  {metric.value}
                  {metric.trend && <Text style={styles.metricTrend}>{metric.trend}</Text>}
                </Text>
              </View>
            )}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  cardLight: {
    backgroundColor: colors.surface,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
    ...shadows.none,
    borderWidth: 1,
    borderColor: darkColors.border,
  },

  // Top row - profile + hero inline
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  // Profile photo with gear badge
  profileTouchArea: {
    width: 44,
    height: 44,
    position: 'relative',
  },
  profilePhoto: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: opacity.overlay.medium,
  },
  profilePhotoDark: {
    backgroundColor: darkColors.border,
    borderColor: opacity.overlayDark.heavy,
  },
  gearBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.pill,
  },
  gearBadgeDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
    ...shadows.none,
  },

  // Hero section - inline horizontal
  heroSection: {
    flex: 1,
    justifyContent: 'center',
  },
  heroValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  heroValue: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28,
    letterSpacing: -0.5,
  },
  heroTrend: {
    fontSize: 18,
    marginLeft: 1,
  },
  heroLabel: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  zoneLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  zoneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Sparkline — own row, full width
  sparklineRow: {
    marginTop: spacing.xs,
  },

  // Accent bar — thin colored line below sparkline
  accentBar: {
    height: 2,
    borderRadius: 1,
    marginTop: spacing.xs,
    marginHorizontal: 0,
  },

  // Supporting metrics row
  supportingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    flexWrap: 'wrap',
    gap: 2,
  },
  supportingMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  metricValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  metricTrend: {
    fontSize: 10,
    marginLeft: 1,
  },
  metricDivider: {
    fontSize: 12,
    color: colors.textMuted,
    marginHorizontal: 3,
  },
  metricDividerDark: {
    color: darkColors.textMuted,
  },

  // Text color utilities
  textSecondary: {
    color: darkColors.textSecondary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});
