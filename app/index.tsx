import React from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  useColorScheme,
} from 'react-native';
import {
  Text,
  ActivityIndicator,
  Surface,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useActivities, useAthlete } from '@/hooks';
import { ActivityCard } from '@/components/activity/ActivityCard';
import { colors, spacing, layout, typography } from '@/theme';
import type { Activity } from '@/types';

export default function FeedScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { data: athlete } = useAthlete();
  const {
    data: activities,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useActivities();

  // DEBUG: Log activities to see if polyline is included
  React.useEffect(() => {
    if (activities && activities.length > 0) {
      console.log('=== ACTIVITIES DEBUG ===');
      console.log('Activities count:', activities.length);
      console.log('First activity keys:', Object.keys(activities[0]));
      console.log('First activity has polyline:', !!activities[0].polyline);
      console.log('First activity has start_latlng:', !!activities[0].start_latlng);
      console.log('First activity:', JSON.stringify(activities[0], null, 2));
    }
  }, [activities]);

  const renderActivity = ({ item }: { item: Activity }) => (
    <ActivityCard activity={item} />
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={[styles.greeting, isDark && styles.textLight]}>
        {athlete?.name ? `Hey, ${athlete.name.split(' ')[0]}` : 'Activities'}
      </Text>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={[styles.emptyText, isDark && styles.textLight]}>
        No activities found
      </Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.errorText}>
        {error instanceof Error ? error.message : 'Failed to load activities'}
      </Text>
    </View>
  );

  if (isLoading && !activities) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, isDark && styles.textLight]}>
            Loading activities...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <FlatList
        data={activities}
        renderItem={renderActivity}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={isError ? renderError : renderEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  header: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  greeting: {
    ...typography.screenTitle,
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
  },
});
