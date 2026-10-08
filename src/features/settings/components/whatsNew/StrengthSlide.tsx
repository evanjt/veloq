import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  BodyPairWithLoupe,
  StrengthBalanceScale,
  balancePairName,
  muscleName,
  type MuscleSlug,
} from '@/features/strength';
import { colors, darkColors, spacing, typography, strengthRamp, bodyDiagram } from '@/theme';

// Illustrative values, in the shape the strength tab draws: each muscle's shade
// on the body's five-step ramp, and two of the antagonist pairs its volume
// split compares, with each side's weighted sets.
const BODY_DATA: ExtendedBodyPart[] = [
  { slug: 'chest', intensity: 3 },
  { slug: 'upper-back', intensity: 4 },
  { slug: 'deltoids', intensity: 2 },
  { slug: 'biceps', intensity: 2 },
  { slug: 'triceps', intensity: 2 },
  { slug: 'quadriceps', intensity: 5 },
  { slug: 'hamstring', intensity: 3 },
  { slug: 'gluteal', intensity: 4 },
  { slug: 'calves', intensity: 1 },
];

const SPLIT_PAIRS: {
  id: string;
  left: MuscleSlug;
  right: MuscleSlug;
  leftSets: number;
  rightSets: number;
}[] = [
  { id: 'chest_back', left: 'chest', right: 'upper-back', leftSets: 9, rightSets: 12 },
  { id: 'quads_hamstrings', left: 'quadriceps', right: 'hamstring', leftSets: 14, rightSets: 8 },
];

const BODY_SCALE = 0.3;
// The pair fills the width it is given, and each body is drawn 200 wide
// before scaling, so the pair is held to the two bodies side by side.
const BODY_PAIR_WIDTH = 2 * 200 * BODY_SCALE;

export function StrengthSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const primaryColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.container}>
      <View style={styles.bodies}>
        <BodyPairWithLoupe
          data={BODY_DATA}
          gender="male"
          scale={BODY_SCALE}
          colors={strengthRamp}
          defaultFill={isDark ? bodyDiagram.fillDark : bodyDiagram.fillLight}
        />
      </View>
      <View style={styles.split}>
        <Text style={[styles.splitTitle, { color: primaryColor }]}>
          {t('insights.strengthBalance.volumeSplit')}
        </Text>
        {SPLIT_PAIRS.map((pair) => (
          <View key={pair.id} style={styles.pair}>
            <Text style={[styles.pairName, { color: primaryColor }]} numberOfLines={1}>
              {balancePairName(pair.id, t)}
            </Text>
            <StrengthBalanceScale
              leftWeightedSets={pair.leftSets}
              rightWeightedSets={pair.rightSets}
            />
            <View style={styles.sides}>
              <Text style={[styles.side, { color: mutedColor }]} numberOfLines={1}>
                {muscleName(pair.left, t)}
              </Text>
              <Text style={[styles.side, { color: mutedColor }]} numberOfLines={1}>
                {muscleName(pair.right, t)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  bodies: {
    width: BODY_PAIR_WIDTH,
  },
  split: {
    flex: 1,
    gap: spacing.sm,
  },
  splitTitle: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
  },
  pair: {
    gap: spacing.xs,
  },
  pairName: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
  },
  sides: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  side: {
    fontSize: typography.label.fontSize,
  },
});
