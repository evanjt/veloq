/**
 * The activities the athlete hid from the heatmap, each with the way to show
 * it again.
 *
 * A hidden activity stays in every list, statistic and section. Only the
 * heatmap leaves it out, so this list is the one place the choice can be
 * undone without opening the activity.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { formatShortDateWithYear } from '@/shared/format/format';
import { Row } from '@/shared/ui/Row';
import { heatmap, type HeatmapHiddenActivity } from 'veloqrs';
import { wallClockSecondsToLocalDate } from '@/shared/time/startDate';
import { themedStyles, typography, type Palette } from '@/theme';

export function HeatmapHiddenList() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const [hidden, setHidden] = useState<HeatmapHiddenActivity[]>(() =>
    heatmap.heatmapHiddenActivities()
  );

  const show = useCallback((activityId: string) => {
    if (heatmap.setActivityHeatmapHidden(activityId, false)) {
      setHidden(heatmap.heatmapHiddenActivities());
    }
  }, []);

  if (hidden.length === 0) return null;

  return (
    <View testID="heatmap-hidden-list">
      <Row>
        <Text style={styles.title}>{t('settings.heatmapHiddenTitle')}</Text>
      </Row>
      {hidden.map((activity) => (
        <Row
          key={activity.activityId}
          testID={`heatmap-hidden-${activity.activityId}`}
          behaviour="act"
          onPress={() => show(activity.activityId)}
          accessibilityLabel={t('settings.heatmapHiddenShowLabel', { name: activity.name })}
        >
          <View style={styles.name}>
            <Text style={styles.title}>{activity.name}</Text>
            <Text style={styles.caption}>
              {formatShortDateWithYear(wallClockSecondsToLocalDate(activity.date))}
            </Text>
          </View>
          <Text style={styles.action}>{t('settings.heatmapHiddenShow')}</Text>
        </Row>
      ))}
    </View>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    name: {
      flex: 1,
    },
    title: {
      ...typography.body,
      color: palette.textPrimary,
    },
    caption: {
      ...typography.caption,
      color: palette.textSecondary,
    },
    action: {
      ...typography.body,
      color: palette.textPrimary,
    },
  });
