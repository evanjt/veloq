import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';
import { useMuscleGroups } from '@/hooks/activities';
import { colors, darkColors, spacing, layout } from '@/theme';

interface MuscleGroupViewProps {
  activityId: string;
  hasExercises: boolean;
  isDark: boolean;
}

export function MuscleGroupView({ activityId, hasExercises, isDark }: MuscleGroupViewProps) {
  const { data: muscleGroups } = useMuscleGroups(activityId, hasExercises);

  if (!muscleGroups || muscleGroups.length === 0) return null;

  const bodyData: ExtendedBodyPart[] = muscleGroups.map((g) => ({
    slug: g.slug as ExtendedBodyPart['slug'],
    intensity: g.intensity,
  }));

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <Text style={[styles.title, isDark && styles.textDark]}>Muscles Targeted</Text>
      <View style={styles.bodyContainer}>
        <View style={styles.bodyView}>
          <Body
            data={bodyData}
            gender="male"
            side="front"
            scale={0.7}
            colors={['#FDCDB9', '#FC4C02', '#D43D00']}
          />
        </View>
        <View style={styles.bodyView}>
          <Body
            data={bodyData}
            gender="male"
            side="back"
            scale={0.7}
            colors={['#FDCDB9', '#FC4C02', '#D43D00']}
          />
        </View>
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#D43D00' }]} />
          <Text style={[styles.legendText, isDark && styles.textSecondaryDark]}>Primary</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#FC4C02' }]} />
          <Text style={[styles.legendText, isDark && styles.textSecondaryDark]}>Secondary</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  bodyContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
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
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textPrimary,
  },
  textSecondaryDark: {
    color: darkColors.textSecondary,
  },
});
