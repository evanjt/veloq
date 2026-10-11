import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { decodeSkylineBytes } from '@/features/activity/lib/skylineDecoder';
import { skylineColours } from '@/features/activity/lib/skylineColours';
import { skylineSegmentHeight, skylineZoneTotals } from '@/features/activity/lib/skylineIntensity';
import { DEFAULT_ZONE_NAME_KEYS } from '@/shared/app/useSportSettings';
import { formatDurationHuman } from '@/shared/format/format';
import { colors, darkColors, spacing, layout } from '@/theme';

interface SkylineBarProps {
  skylineBytes: string;
  isDark: boolean;
  /** Height of the top zone's segments; lower zones stand shorter. */
  height?: number;
}

export const SkylineBar = React.memo(function SkylineBar({
  skylineBytes,
  isDark,
  height = spacing.sm,
}: SkylineBarProps) {
  const { t } = useTranslation();
  const decoded = useMemo(() => decodeSkylineBytes(skylineBytes), [skylineBytes]);

  const label = useMemo(() => {
    if (!decoded) return undefined;
    const basis = decoded.zoneBasis;
    const zones = skylineZoneTotals(decoded)
      .map(({ zone, seconds }) => {
        const key = DEFAULT_ZONE_NAME_KEYS[basis][zone - 1];
        const name = key ? `Z${zone} ${t(key)}` : `Z${zone}`;
        return `${name} ${formatDurationHuman(seconds)}`;
      })
      .join(', ');
    const heading = basis === 'hr' ? t('activity.timeInHRZones') : t('activity.timeInPowerZones');
    return `${heading}: ${zones}`;
  }, [decoded, t]);

  if (!decoded || decoded.intervals.length === 0) return null;

  const fills = skylineColours(decoded, isDark);
  const dividerColor = isDark ? darkColors.surface : colors.surface;

  return (
    <View
      style={[styles.container, { height }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {decoded.intervals.map((interval, i) => {
        const prevZone = i > 0 ? decoded.intervals[i - 1].zone : interval.zone;
        const showDivider = i > 0 && prevZone !== interval.zone;
        return (
          <React.Fragment key={i}>
            {showDivider && <View style={[styles.divider, { backgroundColor: dividerColor }]} />}
            <View
              testID={`skyline-segment-${i}`}
              style={{
                flex: interval.duration,
                height: skylineSegmentHeight(interval.zone, height),
                backgroundColor: fills[i],
              }}
            />
          </React.Fragment>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginHorizontal: spacing.smPlus,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden',
  },
  divider: {
    width: 1,
    alignSelf: 'stretch',
  },
});
