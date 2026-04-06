import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { decodeSkylineBytes } from '@/lib';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/hooks/useSportSettings';
import { colors, darkColors } from '@/theme';

interface SkylineBarProps {
  skylineBytes: string;
  isDark: boolean;
  height?: number;
}

export const SkylineBar = React.memo(function SkylineBar({
  skylineBytes,
  isDark,
  height = 3,
}: SkylineBarProps) {
  const decoded = useMemo(() => decodeSkylineBytes(skylineBytes), [skylineBytes]);

  if (!decoded || decoded.intervals.length === 0) return null;

  const palette = decoded.zoneBasis === 'hr' ? HR_ZONE_COLORS : POWER_ZONE_COLORS;
  const dividerColor = isDark ? darkColors.surface : colors.surface;

  return (
    <View style={[styles.container, { height }]}>
      {decoded.intervals.map((interval, i) => {
        const zoneIndex = Math.min(Math.max(interval.zone - 1, 0), palette.length - 1);
        let color = palette[zoneIndex];
        // Z7 is near-black — swap to light grey in dark mode for visibility
        if (isDark && interval.zone === 7 && decoded.zoneBasis === 'power') {
          color = darkColors.zone7;
        }
        const prevZone = i > 0 ? decoded.intervals[i - 1].zone : interval.zone;
        const showDivider = i > 0 && prevZone !== interval.zone;
        return (
          <React.Fragment key={i}>
            {showDivider && <View style={{ width: 1, backgroundColor: dividerColor }} />}
            <View style={{ flex: interval.duration, backgroundColor: color }} />
          </React.Fragment>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: 12,
    borderRadius: 2,
    overflow: 'hidden',
  },
});
