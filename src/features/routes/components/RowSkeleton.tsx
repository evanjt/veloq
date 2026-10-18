import React from 'react';
import { View } from 'react-native';
import { Card, Shimmer, SkeletonGroup, SkeletonLine } from '@/shared/ui';
import { layout } from '@/theme';
import {
  ROW_PREVIEW_HEIGHT,
  ROW_PREVIEW_WIDTH,
  rowContainers,
} from '@/features/routes/lib/rowLayout';

/** The blocks of one routes or sections row, in the row's own containers. */
function RowBlocks() {
  return (
    <View testID="row-skeleton" style={rowContainers.wrapper}>
      <Card variant="flat" padding="sm" style={rowContainers.card}>
        <View testID="row-skeleton-preview" style={rowContainers.previewBox}>
          <Shimmer
            width={ROW_PREVIEW_WIDTH}
            height={ROW_PREVIEW_HEIGHT}
            borderRadius={layout.borderRadiusXs}
          />
        </View>
        <View style={rowContainers.infoContainer}>
          <View style={rowContainers.nameRow}>
            <SkeletonLine text={rowContainers.name} width="60%" />
          </View>
          <View style={rowContainers.metaRow}>
            <SkeletonLine text={rowContainers.metaText} width="40%" />
          </View>
        </View>
      </Card>
    </View>
  );
}

/** One routes or sections row still to come, such as the next page's. */
export function RowSkeleton() {
  return (
    <SkeletonGroup>
      <RowBlocks />
    </SkeletonGroup>
  );
}

/** A routes or sections list still to come: its rows, read as one loading element. */
export function ListSkeleton({ rows }: { rows: number }) {
  return (
    <SkeletonGroup>
      {Array.from({ length: rows }, (_, i) => (
        <RowBlocks key={i} />
      ))}
    </SkeletonGroup>
  );
}
