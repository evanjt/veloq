import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';
import { useMuscleGroups } from '@/hooks/activities';
import { colors, darkColors, spacing } from '@/theme';

interface MuscleGroupViewProps {
  activityId: string;
  hasExercises: boolean;
  isDark: boolean;
}

const PRIMARY_COLOR = '#FC4C02';
const SECONDARY_COLOR = '#FCA67A';

export function MuscleGroupView({ activityId, hasExercises, isDark }: MuscleGroupViewProps) {
  const { data: muscleGroups } = useMuscleGroups(activityId, hasExercises);

  if (!muscleGroups || muscleGroups.length === 0) return null;

  const bodyData: ExtendedBodyPart[] = muscleGroups.map((g) => ({
    slug: g.slug as ExtendedBodyPart['slug'],
    intensity: g.intensity,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.bodyContainer}>
        <View style={styles.bodyView}>
          <Body
            data={bodyData}
            gender="male"
            side="front"
            scale={0.7}
            colors={['transparent', SECONDARY_COLOR, PRIMARY_COLOR]}
          />
        </View>
        <View style={styles.bodyView}>
          <Body
            data={bodyData}
            gender="male"
            side="back"
            scale={0.7}
            colors={['transparent', SECONDARY_COLOR, PRIMARY_COLOR]}
          />
        </View>
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: PRIMARY_COLOR }]} />
          <Text style={styles.legendText}>Primary</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: SECONDARY_COLOR }]} />
          <Text style={styles.legendText}>Secondary</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  bodyContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bodyView: {
    flex: 1,
    alignItems: 'center',
    maxWidth: '45%',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: 4,
    marginBottom: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: darkColors.textSecondary,
  },
});
