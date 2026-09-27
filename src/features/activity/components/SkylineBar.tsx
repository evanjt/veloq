import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { decodeSkylineBytes } from '@/features/activity/lib/skylineDecoder';
import { skylineColours } from '@/features/activity/lib/skylineColours';
import { colors, darkColors, spacing } from '@/theme';

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

  const fills = skylineColours(decoded, isDark);
  const dividerColor = isDark ? darkColors.surface : colors.surface;

  return (
    <View style={[styles.container, { height }]}>
      {decoded.intervals.map((interval, i) => {
        const prevZone = i > 0 ? decoded.intervals[i - 1].zone : interval.zone;
        const showDivider = i > 0 && prevZone !== interval.zone;
        return (
          <React.Fragment key={i}>
            {showDivider && <View style={{ width: 1, backgroundColor: dividerColor }} />}
            <View style={{ flex: interval.duration, backgroundColor: fills[i] }} />
          </React.Fragment>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: spacing.smPlus,
    borderRadius: spacing.xxs,
    overflow: 'hidden',
  },
});
