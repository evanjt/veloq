import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme, Text } from 'react-native';
import { colors } from '@/theme';
import { useHRZones, type HRZone } from '@/providers';
import type { ActivityStreams } from '@/types';

interface HRZonesChartProps {
  streams: ActivityStreams;
  /** Max heart rate override (uses stored max HR if not provided) */
  maxHR?: number;
  /** Height of the chart */
  height?: number;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hrs}h ${remainingMins}m` : `${hrs}h`;
}

export function HRZonesChart({
  streams,
  maxHR: maxHRProp,
  height = 140,
}: HRZonesChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Get stored HR zones settings
  const { maxHR: storedMaxHR, zones } = useHRZones();

  // Use prop override if provided, otherwise use stored value
  const maxHR = maxHRProp ?? storedMaxHR;

  // Calculate time in each zone
  const zoneData = useMemo(() => {
    const { heartrate, time } = streams;
    if (!heartrate || !time || heartrate.length < 2) {
      return null;
    }

    // Initialize zone times
    const zoneTimes: number[] = zones.map(() => 0);
    let totalTime = 0;

    // Calculate time in each zone
    for (let i = 1; i < heartrate.length; i++) {
      const hr = heartrate[i];
      const dt = time[i] - time[i - 1];

      if (dt > 0 && dt < 60 && hr > 0) { // Sanity check
        totalTime += dt;
        const hrPercent = hr / maxHR;

        // Find which zone this HR falls into
        for (let z = zones.length - 1; z >= 0; z--) {
          if (hrPercent >= zones[z].min) {
            zoneTimes[z] += dt;
            break;
          }
        }
      }
    }

    if (totalTime === 0) return null;

    // Convert to percentages and formatted times
    return zones.map((zone, idx) => ({
      ...zone,
      seconds: zoneTimes[idx],
      percent: (zoneTimes[idx] / totalTime) * 100,
      formatted: formatDuration(zoneTimes[idx]),
    }));
  }, [streams, maxHR, zones]);

  if (!zoneData) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>
          No heart rate data
        </Text>
      </View>
    );
  }

  const maxPercent = Math.max(...zoneData.map(z => z.percent), 1);

  return (
    <View style={[styles.container, { height }]}>
      <Text style={[styles.title, isDark && styles.titleDark]}>Time in HR Zones</Text>
      <View style={styles.zonesContainer}>
        {zoneData.map((zone) => (
          <View key={zone.id} style={styles.zoneRow}>
            <View style={styles.zoneLabelContainer}>
              <Text style={[styles.zoneNumber, { color: zone.color }]}>Z{zone.id}</Text>
              <Text style={[styles.zoneName, isDark && styles.zoneNameDark]}>{zone.name}</Text>
            </View>
            <View style={styles.barContainer}>
              <View
                style={[
                  styles.bar,
                  {
                    width: `${(zone.percent / maxPercent) * 100}%`,
                    backgroundColor: zone.color,
                  },
                ]}
              />
            </View>
            <Text style={[styles.zoneTime, isDark && styles.zoneTimeDark]}>
              {zone.percent > 0.5 ? zone.formatted : '-'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  titleDark: {
    color: '#FFF',
  },
  zonesContainer: {
    flex: 1,
    justifyContent: 'space-around',
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  zoneLabelContainer: {
    width: 80,
    flexDirection: 'row',
    alignItems: 'center',
  },
  zoneNumber: {
    fontSize: 12,
    fontWeight: '700',
    width: 24,
  },
  zoneName: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  zoneNameDark: {
    color: '#888',
  },
  barContainer: {
    flex: 1,
    height: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    borderRadius: 8,
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  bar: {
    height: '100%',
    borderRadius: 8,
  },
  zoneTime: {
    width: 50,
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'right',
  },
  zoneTimeDark: {
    color: '#AAA',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  textDark: {
    color: '#888',
  },
});
