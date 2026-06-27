import React from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing, workoutStepColors } from '@/theme';
import type { WorkoutStep } from '@/types';

interface WorkoutStepBarProps {
  steps: WorkoutStep[];
  height?: number;
}

/**
 * Visual workout intensity bar showing workout structure as colored blocks.
 * Each block width is proportional to duration. Colors encode intensity:
 * warmup/tempo=amber, threshold/VO2=red, rest=grey, cooldown=blue.
 */
export const WorkoutStepBar = React.memo(function WorkoutStepBar({
  steps,
  height = 6,
}: WorkoutStepBarProps) {
  const flatSteps = flattenSteps(steps);
  const totalDuration = flatSteps.reduce((sum, s) => sum + (s.duration || 60), 0);

  if (totalDuration === 0 || flatSteps.length === 0) return null;

  return (
    <View style={[styles.container, { height }]}>
      {flatSteps.map((step, i) => {
        const duration = step.duration || 60;
        const widthPercent = (duration / totalDuration) * 100;
        const color = getStepColor(step);
        return (
          <View
            key={i}
            style={[
              styles.block,
              {
                width: `${widthPercent}%`,
                backgroundColor: color,
                borderTopLeftRadius: i === 0 ? 3 : 0,
                borderBottomLeftRadius: i === 0 ? 3 : 0,
                borderTopRightRadius: i === flatSteps.length - 1 ? 3 : 0,
                borderBottomRightRadius: i === flatSteps.length - 1 ? 3 : 0,
              },
            ]}
          />
        );
      })}
    </View>
  );
});

/** Flatten nested repeat blocks into a linear step array */
function flattenSteps(steps: WorkoutStep[]): WorkoutStep[] {
  const result: WorkoutStep[] = [];
  for (const step of steps) {
    if (step.steps && step.reps) {
      for (let r = 0; r < step.reps; r++) {
        result.push(...flattenSteps(step.steps));
      }
    } else {
      result.push(step);
    }
  }
  return result;
}

function getStepColor(step: WorkoutStep): string {
  if (step.warmup) return workoutStepColors.warmup;
  if (step.cooldown) return workoutStepColors.cooldown;

  // Check intensity from resolved power targets.
  // Estimate intensity relative to typical FTP (~280W); exact FTP isn't
  // critical, we just need visual differentiation.
  const power = step._power;
  if (power) {
    const target = power.value ?? power.end ?? power.start ?? 0;
    if (target === 0) return workoutStepColors.rest;
    if (target < 150) return workoutStepColors.rest;
    if (target < 220) return workoutStepColors.tempo;
    return workoutStepColors.threshold;
  }

  // Check HR targets
  if (step.hr) {
    const target = step.hr.value ?? step.hr.end ?? 0;
    if (target === 0) return workoutStepColors.rest;
    if (target < 140) return workoutStepColors.rest;
    if (target < 160) return workoutStepColors.tempo;
    return workoutStepColors.threshold;
  }

  // No target = rest interval
  if (step.text?.toLowerCase().includes('recover')) return workoutStepColors.rest;
  if (step.text?.toLowerCase().includes('rest')) return workoutStepColors.rest;

  return workoutStepColors.threshold;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  block: {
    height: '100%',
  },
});
