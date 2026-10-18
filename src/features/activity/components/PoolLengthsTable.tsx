import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PoolSwimState, PoolUnit, type PoolLength, type PoolSwim } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { ABSENT } from '@/shared/format/absent';
import { formatDecimalTrimmed } from '@/shared/format/number';
import { formatDuration, formatSwimPace, swimPaceUnitLabel } from '@/shared/format/format';
import { Card, CardHeader, DataTable, type DataTableRow } from '@/shared/ui';
import { spacing, themePalette, typography } from '@/theme';

const METRES_PER_YARD = 0.9144;

/** Column shares that give a stroke name such as "Breaststroke" its whole width on a phone. */
const STROKE_TABLE_WEIGHTS = [1.9, 1.2, 1.35, 0.9, 1.2, 1];
const LENGTH_TABLE_WEIGHTS = [0.6, 2.4, 1, 1.1, 1.2, 1];

/**
 * Whether the detail screen offers a Lengths tab: while the file is still
 * owed, so the pending line has somewhere to stand, and once lengths are
 * stored. A swim settled with none has nothing to put in it.
 */
export function showsPoolLengthsTab(poolSwim: PoolSwim | null | undefined): boolean {
  if (!poolSwim) return false;
  if (poolSwim.state === PoolSwimState.Owed) return true;
  return poolSwim.state === PoolSwimState.Read && poolSwim.lengths.length > 0;
}

/** A distance in the pool's own unit, whole metres or whole yards. */
function formatPoolDistance(metres: number | undefined, unit: PoolUnit): string {
  if (metres == null) return ABSENT;
  return unit === PoolUnit.Yards
    ? `${Math.round(metres / METRES_PER_YARD)} yd`
    : `${Math.round(metres)} m`;
}

/** A SWOLF as a whole number, or to one place when the read carries a fraction. */
function formatSwolf(swolf: number | undefined): string {
  return formatDecimalTrimmed(swolf, 1);
}

/** The engine's stroke keys, each with its label; a key it adds later reads as unknown. */
const STROKE_LABELS = {
  freestyle: 'poolSwim.strokes.freestyle',
  backstroke: 'poolSwim.strokes.backstroke',
  breaststroke: 'poolSwim.strokes.breaststroke',
  butterfly: 'poolSwim.strokes.butterfly',
  drill: 'poolSwim.strokes.drill',
  mixed: 'poolSwim.strokes.mixed',
  im: 'poolSwim.strokes.im',
  reverseIm: 'poolSwim.strokes.reverseIm',
} as const;

function strokeName(key: string | undefined, t: TFunction): string {
  const label =
    key != null && Object.hasOwn(STROKE_LABELS, key)
      ? STROKE_LABELS[key as keyof typeof STROKE_LABELS]
      : 'poolSwim.strokes.unknown';
  return t(label);
}

/**
 * The lengths in file order, each active one numbered among the active ones
 * and each rest a row of its own, so the runs between rests read as runs.
 */
function lengthRows(lengths: PoolLength[], isMetric: boolean, t: TFunction): DataTableRow[] {
  let swum = 0;
  return lengths.map((length) => {
    const time = length.elapsedSecs != null ? formatDuration(length.elapsedSecs) : ABSENT;
    if (!length.active) {
      return { key: `rest-${length.index}`, cells: ['', t('poolSwim.rest'), time, '', '', ''] };
    }
    swum += 1;
    return {
      key: `length-${length.index}`,
      cells: [
        String(swum),
        strokeName(length.strokeKey, t),
        time,
        length.strokes != null ? String(length.strokes) : ABSENT,
        length.speedMps != null ? formatSwimPace(length.speedMps, isMetric) : ABSENT,
        formatSwolf(length.swolf),
      ],
    };
  });
}

interface PoolLengthsTableProps {
  poolSwim: PoolSwim;
}

/** A pool swim's per-stroke totals and its lengths, every figure as the read gives it. */
export function PoolLengthsTable({ poolSwim }: PoolLengthsTableProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);

  if (poolSwim.state === PoolSwimState.Owed) {
    return (
      <View style={styles.frame}>
        <Card variant="raised">
          <Text style={[styles.pending, { color: palette.textSecondary }]}>
            {t('poolSwim.pending')}
          </Text>
        </Card>
      </View>
    );
  }

  if (!showsPoolLengthsTab(poolSwim)) return null;

  const unit = poolSwim.poolUnit;
  const isMetric = unit !== PoolUnit.Yards;
  const pace = `${t('poolSwim.columns.pace')} ${swimPaceUnitLabel(isMetric)}`;
  const poolLength =
    poolSwim.poolLengthM != null
      ? t('poolSwim.poolLength', { length: formatPoolDistance(poolSwim.poolLengthM, unit) })
      : undefined;

  const strokeRows: DataTableRow[] = poolSwim.strokeTotals.map((total) => ({
    key: total.strokeKey,
    cells: [
      strokeName(total.strokeKey, t),
      String(total.lengths),
      formatPoolDistance(total.distanceM, unit),
      formatDuration(total.elapsedSecs),
      total.speedMps != null ? formatSwimPace(total.speedMps, isMetric) : ABSENT,
      formatSwolf(total.avgSwolf),
    ],
  }));

  return (
    <>
      <View style={styles.frame}>
        <Card variant="raised" padding="none">
          <View style={styles.header}>
            <CardHeader title={t('poolSwim.byStroke')} subtitle={poolLength} />
          </View>
          <DataTable
            columns={[
              t('poolSwim.columns.stroke'),
              t('poolSwim.columns.lengths'),
              t('poolSwim.columns.distance'),
              t('poolSwim.columns.time'),
              pace,
              t('poolSwim.columns.swolf'),
            ]}
            rows={strokeRows}
            rowTestIDPrefix="pool-stroke-row-"
            columnWeights={STROKE_TABLE_WEIGHTS}
          />
        </Card>
      </View>
      <View style={styles.frame}>
        <Card variant="raised" padding="none">
          <View style={styles.header}>
            <CardHeader title={t('poolSwim.lengths')} />
          </View>
          <DataTable
            columns={[
              t('poolSwim.columns.number'),
              t('poolSwim.columns.stroke'),
              t('poolSwim.columns.time'),
              t('poolSwim.columns.strokes'),
              pace,
              t('poolSwim.columns.swolf'),
            ]}
            rows={lengthRows(poolSwim.lengths, isMetric, t)}
            rowTestIDPrefix="pool-length-row-"
            columnWeights={LENGTH_TABLE_WEIGHTS}
          />
        </Card>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginBottom: spacing.sm,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  pending: {
    ...typography.caption,
    textAlign: 'center',
  },
});
