import { RefObject } from 'react';
import { View, TouchableOpacity, TextInput } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { getActivityIcon } from '@/features/activity/lib/activityUtils';
import { formatDistance, formatRelativeDate } from '@/shared/format/format';
import { colors } from '@/theme';
import type { ActivityType } from '@/types';
import { styles } from './RouteDetailScreen.styles';
import type { RouteStats } from '../lib/computeRouteStats';

interface RouteDetailHeaderInfoProps {
  customName: string | null;
  routeName: string;
  isEditing: boolean;
  editName: string;
  nameInputRef: RefObject<TextInput | null>;
  displayType: ActivityType;
  activityColor: string;
  routeStats: RouteStats;
  activityCount: number;
  isMetric: boolean;
  onStartEdit: () => void;
  onSaveName: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (text: string) => void;
}

export function RouteDetailHeaderInfo({
  customName,
  routeName,
  isEditing,
  editName,
  nameInputRef,
  displayType,
  activityColor,
  routeStats,
  activityCount,
  isMetric,
  onStartEdit,
  onSaveName,
  onCancelEdit,
  onEditNameChange,
}: RouteDetailHeaderInfoProps) {
  const { t } = useTranslation();
  const iconName = getActivityIcon(displayType);

  return (
    <View style={styles.infoOverlay}>
      <View style={styles.routeNameRow}>
        <View style={[styles.typeIcon, { backgroundColor: activityColor }]}>
          <MaterialCommunityIcons name={iconName} size={16} color={colors.textOnDark} />
        </View>
        {isEditing ? (
          <View style={styles.editNameContainer}>
            <TextInput
              testID="route-rename-input"
              ref={nameInputRef}
              style={styles.editNameInput}
              value={editName}
              onChangeText={onEditNameChange}
              onSubmitEditing={onSaveName}
              placeholder={t('routes.routeNamePlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.5)"
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
            />
            <TouchableOpacity
              testID="route-rename-save"
              onPress={onSaveName}
              style={styles.editNameButton}
            >
              <MaterialCommunityIcons name="check" size={20} color={colors.success} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onCancelEdit} style={styles.editNameButton}>
              <MaterialCommunityIcons name="close" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            testID="route-rename-button"
            onPress={onStartEdit}
            style={styles.nameEditTouchable}
            activeOpacity={0.7}
          >
            <Text testID="route-detail-name" style={styles.heroRouteName} numberOfLines={1}>
              {customName || routeName}
            </Text>
            <MaterialCommunityIcons
              name="pencil"
              size={14}
              color="rgba(255,255,255,0.6)"
              style={styles.editIcon}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Stats row */}
      <View testID="route-detail-stats" style={styles.heroStatsRow}>
        <Text style={styles.heroStat}>{formatDistance(routeStats.distance, isMetric)}</Text>
        <Text style={styles.heroStatDivider}>·</Text>
        <Text style={styles.heroStat}>{activityCount} activities</Text>
        <Text style={styles.heroStatDivider}>·</Text>
        <Text style={styles.heroStat}>
          {routeStats.lastDate ? formatRelativeDate(routeStats.lastDate) : '-'}
        </Text>
      </View>
    </View>
  );
}
