import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { decodeSkylineBytes } from '@/features/activity/lib/skylineDecoder';
import { skylineColours } from '@/features/activity/lib/skylineColours';
import { skylineSegmentHeight, skylineZoneTotals } from '@/features/activity/lib/skylineIntensity';
import { ZONE_STRIP_HEIGHT } from '@/features/activity/lib/cardLayout';
import { DEFAULT_ZONE_NAME_KEYS } from '@/shared/app/useSportSettings';
import { formatDurationHuman } from '@/shared/format/format';
import { ChartSurface, partsSummary, partsTable } from '@/shared/charts';
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
  height = ZONE_STRIP_HEIGHT,
}: SkylineBarProps) {
  const { t } = useTranslation();
  const decoded = useMemo(() => decodeSkylineBytes(skylineBytes), [skylineBytes]);

  // What a screen reader hears and the Show data sheet lists: the time in each zone.
  const reading = useMemo(() => {
    if (!decoded) return null;
    const basis = decoded.zoneBasis;
    const parts = skylineZoneTotals(decoded).map(({ zone, seconds }) => {
      const key = DEFAULT_ZONE_NAME_KEYS[basis][zone - 1];
      return {
        label: key ? `Z${zone} ${t(key)}` : `Z${zone}`,
        value: formatDurationHuman(seconds),
      };
    });
    const title = basis === 'hr' ? t('activity.timeInHRZones') : t('activity.timeInPowerZones');
    return {
      summary: partsSummary(title, parts, t),
      table: partsTable(title, t('charts.column.zone'), t('charts.column.time'), parts),
    };
  }, [decoded, t]);

  if (!decoded || !reading || decoded.intervals.length === 0) return null;

  const fills = skylineColours(decoded, isDark);
  const dividerColor = isDark ? darkColors.surface : colors.surface;

  return (
    <ChartSurface
      summary={reading.summary}
      table={reading.table}
      style={[styles.container, { height }]}
      showDataButton={false}
    >
      {decoded.intervals.map((interval, i) => {
        const prevZone = i > 0 ? decoded.intervals[i - 1].zone : interval.zone;
        const showDivider = i > 0 && prevZone !== interval.zone;
        return (
          <React.Fragment key={i}>
            {showDivider ? (
              <View style={[styles.divider, { backgroundColor: dividerColor }]} />
            ) : null}
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
    </ChartSurface>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 0,
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
