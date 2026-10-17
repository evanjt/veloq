import React, { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { tapTo } from '@/shared/app/navigation';
import { composeAccessibilityLabel, Row, Shimmer, SkeletonFrame } from '@/shared/ui';
import {
  colors,
  darkColors,
  spacing,
  typography,
  colorWithOpacity,
  ink,
  stroke,
  layout,
  opacity,
} from '@/theme';
import type { PrimarySport } from '@/features/fitness/stores';
import { NameText } from '@/shared/ui/NameText';

/** The activity a best was set in, as the label read names it. */
export interface BestEffortActivity {
  id: string;
  name: string;
  date: string;
}

interface BestEffortRowProps {
  /** The window or distance the best is for. */
  label: string;
  value: string;
  /** A line under the value, such as the time a pace was held for. */
  secondary?: string | null;
  valueColor: string;
  isLast: boolean;
  /**
   * The activity the best was set in. When known, the row states its name and
   * date and opens it from the whole row.
   */
  activity?: BestEffortActivity | undefined;
  testID?: string | undefined;
  /** What the activity column shows when no activity is known, such as a note. */
  children?: ReactNode;
}

/**
 * One best in a list of bests: label, value and the activity it came from.
 *
 * The label and value columns size from their content rather than from a fixed
 * width, so a long time at a large system text size stays on one line, and the
 * activity column takes what is left.
 */
export function BestEffortRow({
  label,
  value,
  secondary,
  valueColor,
  isLast,
  activity,
  testID,
  children,
}: BestEffortRowProps) {
  const { isDark } = useTheme();

  const body = (
    <>
      <Text style={[styles.label, isDark && styles.labelDark]}>{label}</Text>
      <View style={styles.valueColumn} testID={testID ? `${testID}-value` : undefined}>
        <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
        {secondary ? (
          <Text style={[styles.secondary, isDark && styles.secondaryDark]}>{secondary}</Text>
        ) : null}
      </View>
      <View style={styles.activityColumn}>
        {activity ? (
          <>
            <NameText style={[styles.activityName, isDark && styles.textDark]}>
              {activity.name}
            </NameText>
            <Text style={[styles.secondary, isDark && styles.secondaryDark]}>{activity.date}</Text>
          </>
        ) : (
          children
        )}
      </View>
    </>
  );

  return (
    <View style={[!isLast && styles.rowBorder, !isLast && isDark && styles.rowBorderDark]}>
      {activity ? (
        <Row
          testID={testID}
          inset="none"
          behaviour="navigate"
          onPress={() => tapTo(`/activity/${activity.id}`)}
          accessibilityLabel={composeAccessibilityLabel(
            label,
            value,
            secondary,
            activity.name,
            activity.date
          )}
        >
          {body}
        </Row>
      ) : (
        <Row testID={testID} inset="none">
          {body}
        </Row>
      )}
    </View>
  );
}

/**
 * How many rows each list of bests holds once read: the engine reads five
 * power or run checkpoints, four swim ones and six climbing windows. A
 * placeholder draws the same count, so the card does not grow when it arrives.
 */
export const BEST_EFFORT_ROW_COUNT: Record<PrimarySport | 'climbing', number> = {
  Cycling: 5,
  Running: 5,
  Swimming: 4,
  climbing: 6,
};

/** A list of bests while its read is pending, each row the height of the row it becomes. */
export function BestEffortRowsSkeleton({ rows }: { rows: number }) {
  const { isDark } = useTheme();
  return (
    <SkeletonFrame testID="best-effort-rows-skeleton">
      {Array.from({ length: rows }, (_, index) => {
        const isLast = index === rows - 1;
        return (
          <View
            key={index}
            style={[!isLast && styles.rowBorder, !isLast && isDark && styles.rowBorderDark]}
          >
            <Row inset="none">
              <View style={styles.labelPlaceholder}>
                <Shimmer
                  height={typography.bodySmall.lineHeight}
                  borderRadius={layout.borderRadiusXs}
                />
              </View>
              <View style={styles.valueColumn}>
                <Shimmer height={typography.body.lineHeight} borderRadius={layout.borderRadiusXs} />
              </View>
              <View style={styles.activityColumn}>
                <Shimmer
                  width="70%"
                  height={typography.caption.lineHeight}
                  borderRadius={layout.borderRadiusXs}
                />
                <Shimmer
                  width="40%"
                  height={typography.micro.lineHeight}
                  borderRadius={layout.borderRadiusXs}
                  style={styles.secondaryPlaceholder}
                />
              </View>
            </Row>
          </View>
        );
      })}
    </SkeletonFrame>
  );
}

const styles = StyleSheet.create({
  rowBorder: {
    borderBottomWidth: stroke.hairline,
    borderBottomColor: colorWithOpacity(ink.black, opacity.tint1),
  },
  rowBorderDark: {
    borderBottomColor: colorWithOpacity(ink.white, opacity.tint1),
  },
  label: {
    ...typography.bodySmallBold,
    color: colors.textSecondary,
    minWidth: spacing.xxl,
    flexShrink: 1,
  },
  labelPlaceholder: {
    width: spacing.xxl,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  valueColumn: {
    minWidth: spacing.xxl * 2,
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  value: {
    ...typography.bodyBold,
    fontVariant: ['tabular-nums'],
  },
  secondary: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
    fontVariant: ['tabular-nums'],
  },
  secondaryPlaceholder: {
    marginTop: spacing.xxs,
  },
  secondaryDark: {
    color: darkColors.textSecondary,
  },
  activityColumn: {
    flex: 1,
    minWidth: 0,
    marginLeft: spacing.xs,
  },
  activityName: {
    ...typography.captionBold,
    color: colors.textPrimary,
  },
  textDark: {
    color: darkColors.textPrimary,
  },
});
