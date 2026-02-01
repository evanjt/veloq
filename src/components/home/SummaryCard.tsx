import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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

  // Sparkline data (7 days)
  sparklineData?: number[];
  showSparkline: boolean;

  // Supporting metrics (max 4)
  supportingMetrics: SupportingMetric[];
}

/**
 * Summary card for the home screen hero section.
 *
 * Displays a profile photo with gear badge, hero metric with sparkline,
 * and supporting metrics row in a compact layout.
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────┐
 * │ [👤⚙]   +20 Form Fresh●    ▁▂▃▄▃▅▆▇▆▅▄▃  7d       │
 * │   Fitness 34  ·  FTP 168  ·  0.4h  ·  #1           │
 * └─────────────────────────────────────────────────────┘
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

  return (
    <View style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
      {/* Main row: Profile + Hero + Sparkline */}
      <View style={styles.mainRow}>
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

        {/* Hero metric - compact inline */}
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

        {/* Sparkline - zone-colored line */}
        {showSparkline && sparklineData && sparklineData.length > 0 && (
          <SummaryCardSparkline
            data={sparklineData}
            color={heroColor}
            width={140}
            height={48}
            label="30d"
          />
        )}
      </View>

      {/* Supporting metrics row */}
      <View style={styles.supportingRow}>
        {supportingMetrics.slice(0, 4).map((metric, index) => (
          <React.Fragment key={metric.label}>
            {index > 0 && (
              <Text style={[styles.metricDivider, isDark && styles.metricDividerDark]}>
                {'\u00B7'}
              </Text>
            )}
            <View style={styles.supportingMetric}>
              <Text style={[styles.metricLabel, isDark && styles.textMuted]}>{metric.label}</Text>
              <Text
                style={[
                  styles.metricValue,
                  { color: metric.color || (isDark ? darkColors.textPrimary : colors.textPrimary) },
                ]}
              >
                {metric.value}
                {metric.trend && <Text style={styles.metricTrend}>{metric.trend}</Text>}
              </Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    padding: spacing.sm,
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

  // Main row - all elements in one line
  mainRow: {
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

  // Sparkline - larger and prominent
  sparklineContainer: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  sparklineLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textMuted,
  },

  // Supporting metrics row
  supportingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  supportingMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metricLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  metricTrend: {
    fontSize: 11,
    marginLeft: 1,
  },
  metricDivider: {
    fontSize: 14,
    color: colors.textMuted,
    marginHorizontal: spacing.xs,
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
