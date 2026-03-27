import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';
import { useMuscleGroups } from '@/hooks/activities';
import { colors, darkColors, spacing } from '@/theme';

interface MuscleGroupViewProps {
  activityId: string;
  hasExercises: boolean;
  isDark: boolean;
  /** "M", "F", or undefined — from intervals.icu athlete profile */
  athleteSex?: string;
}

const PRIMARY_COLOR = '#FC4C02';
const SECONDARY_COLOR = '#FCA67A';
const CITATION_URL = 'https://github.com/yuhonas/free-exercise-db';

export function MuscleGroupView({
  activityId,
  hasExercises,
  isDark,
  athleteSex,
}: MuscleGroupViewProps) {
  const { data: muscleGroups } = useMuscleGroups(activityId, hasExercises);

  const handleCitationPress = useCallback(() => {
    Linking.openURL(CITATION_URL);
  }, []);

  if (!muscleGroups || muscleGroups.length === 0) return null;

  const bodyData: ExtendedBodyPart[] = muscleGroups.map((g) => ({
    slug: g.slug as ExtendedBodyPart['slug'],
    intensity: g.intensity,
  }));

  const hasGender = athleteSex === 'M' || athleteSex === 'F';
  const gender = athleteSex === 'F' ? 'female' : 'male';

  return (
    <View style={styles.container}>
      <View style={styles.bodyContainer}>
        <View style={styles.bodyView}>
          <Body
            data={bodyData}
            gender={gender}
            side="front"
            scale={0.7}
            colors={[SECONDARY_COLOR, PRIMARY_COLOR]}
          />
        </View>
        <View style={styles.bodyView}>
          <Body
            data={bodyData}
            gender={gender}
            side="back"
            scale={0.7}
            colors={[SECONDARY_COLOR, PRIMARY_COLOR]}
          />
        </View>
      </View>
      <View style={styles.footer}>
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
        <Pressable onPress={handleCitationPress} hitSlop={8}>
          <Text style={styles.citation}>free-exercise-db</Text>
        </Pressable>
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: spacing.xs,
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.md,
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
  citation: {
    fontSize: 10,
    color: darkColors.textSecondary,
    opacity: 0.6,
  },
});
