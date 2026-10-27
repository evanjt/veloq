/**
 * What an activity's map sheet shows at its lowest stop: the name, the date line, and the
 * distance, moving time and climbing. With debug on, a long press on the name offers clones of
 * the activity for testing.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { engine } from 'veloqrs';

import { repostActivityNotification } from '@/features/insights';
import { Button } from '@/shared/ui/Button';
import { HeroNameRow, HeroStatsRow, heroPeekStyles } from '@/shared/ui/DetailHero';
import { PressTarget } from '@/shared/ui/PressTarget';
import { FitText } from '@/shared/ui/FitText';
import { CONFIRM_HOLD_MS } from '@/shared/ui/holdDurations';
import { chooseAction, inform } from '@/shared/ui/dialog';
import { useTheme } from '@/shared/app';
import { MapSheetCardCloseSpace } from '@/shared/app/MapSheetCards';
import { formatDateTime } from '@/shared/format/format';
import { getActivityColor, getActivityIcon } from '@/shared/activity/activityUtils';
import type { ActivityType } from '@/types';
import { colors, darkColors } from '@/theme';
import type { activityHeroStats } from '../lib/activityHeroStats';

export interface ActivityPeekProps {
  activityId: string;
  name: string;
  activityType: ActivityType;
  startDateLocal: string | undefined;
  stats: ReturnType<typeof activityHeroStats>;
  debugEnabled: boolean;
}

export function ActivityPeek({
  activityId,
  name,
  activityType,
  startDateLocal,
  stats,
  debugEnabled,
}: ActivityPeekProps) {
  const { isDark } = useTheme();
  const nameRow = (
    <HeroNameRow
      onSurface
      name={name}
      nameTestID="activity-detail-name"
      accessory={<MapSheetCardCloseSpace />}
      icon={{ name: getActivityIcon(activityType), color: getActivityColor(activityType) }}
    />
  );
  return (
    <View testID="activity-card-peek" style={heroPeekStyles.peek}>
      {debugEnabled ? (
        <PressTarget
          accessibilityRole="button"
          accessibilityLabel={name}
          testID="activity-detail-clone"
          delayLongPress={CONFIRM_HOLD_MS}
          onLongPress={() => offerClones(activityId, name)}
        >
          {nameRow}
        </PressTarget>
      ) : (
        nameRow
      )}
      {startDateLocal ? (
        <FitText
          testID="activity-card-date-line"
          style={[heroPeekStyles.dateLine, styles.dateLine, isDark && styles.dateLineDark]}
        >
          {formatDateTime(startDateLocal)}
        </FitText>
      ) : null}
      <HeroStatsRow
        onSurface
        testID="activity-detail-stats"
        statTestIDs={['activity-detail-distance', 'activity-detail-duration']}
        stats={stats}
      />
      {debugEnabled ? (
        <Button
          label={REGENERATE_LABEL}
          variant="secondary"
          size="sm"
          testID="activity-regenerate-notification"
          onPress={() => void repostNotification(activityId, name)}
        />
      ) : null}
      {debugEnabled ? (
        <Button
          label={REGENERATE_DELAYED_LABEL}
          variant="secondary"
          size="sm"
          testID="activity-regenerate-notification-delayed"
          onPress={() => void repostNotification(activityId, name, DEBUG_REPOST_DELAY_SECONDS)}
        />
      ) : null}
    </View>
  );
}

const REGENERATE_LABEL = 'Regenerate notification';
const REGENERATE_DELAYED_LABEL = 'Regenerate in 20 s';
const DEBUG_REPOST_DELAY_SECONDS = 20;

async function repostNotification(activityId: string, name: string, delaySeconds?: number) {
  if (
    !(await repostActivityNotification(
      activityId,
      name,
      engine.activityNotification.bind(engine),
      delaySeconds
    ))
  ) {
    inform({ title: 'Nothing to post', message: 'The engine has no text for this activity.' });
  }
}

function offerClones(activityId: string, name: string) {
  const doClone = (n: number) => {
    const created = engine.debugCloneActivity(activityId, n);
    inform({ title: 'Done', message: `Created ${created} clones` });
  };
  chooseAction({
    title: 'Clone for Testing',
    message: `Clone "${name}" to stress test sections and routes.`,
    cancelLabel: 'Cancel',
    actions: [
      { label: '10 clones', onPress: () => doClone(10) },
      {
        label: 'More...',
        onPress: () => {
          chooseAction({
            title: 'Clone Amount',
            message: 'Choose number of clones:',
            cancelLabel: 'Cancel',
            actions: [
              { label: '50 clones', onPress: () => doClone(50) },
              { label: '100 clones', onPress: () => doClone(100) },
            ],
          });
        },
      },
    ],
  });
}

const styles = StyleSheet.create({
  dateLine: {
    color: colors.textSecondary,
  },
  dateLineDark: {
    color: darkColors.textSecondary,
  },
});
