/**
 * One direction's recent attempts on a section, inline in its row: speed per
 * attempt placed by date, this activity marked by the reticle, and the range
 * printed beside it. The row is one pressable element, so it speaks the
 * summary in its own label and the plot offers no Show data of its own.
 */

import React from 'react';
import { Sparkline, type SparklinePoint } from '@/shared/charts';

interface SectionSparklineProps {
  points: readonly SparklinePoint[];
  /** The quantity drawn, speed or pace. */
  name: string;
  format: (metresPerSecond: number) => string;
  width: number;
  height: number;
  /** The index of this activity's attempt, when it is among the points. */
  highlightIndex?: number | undefined;
  /** What the plot speaks, the same sentence the row speaks. */
  summary: string;
  testID?: string | undefined;
}

export const SectionSparkline = React.memo(function SectionSparkline({
  points,
  name,
  format,
  width,
  height,
  highlightIndex,
  summary,
  testID,
}: SectionSparklineProps) {
  if (points.length < 2 || width <= 0 || height <= 0) return null;
  return (
    <Sparkline
      testID={testID}
      name={name}
      points={points}
      format={format}
      width={width}
      height={height}
      highlightIndex={highlightIndex}
      summary={summary}
      showRange
    />
  );
});
