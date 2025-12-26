import React from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { MaterialIconName } from '@/lib';

interface Event {
  id: string;
  name: string;
  date: string;
  type: 'race' | 'event' | 'training';
  priority: 'A' | 'B' | 'C';
  distance?: number;
  notes?: string;
}

interface EventPlannerProps {
  events?: Event[];
  athleteId?: string;
}

function getDaysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PRIORITY_COLORS = {
  A: '#E91E63', // Pink - priority race
  B: '#FF9800', // Orange - secondary
  C: '#9E9E9E', // Gray - training
};

const TYPE_ICONS: Record<Event['type'], MaterialIconName> = {
  race: 'flag-checkered',
  event: 'calendar-star',
  training: 'dumbbell',
};

export function EventPlanner({ events, athleteId }: EventPlannerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const sortedEvents = [...(events || [])]
    .filter(e => getDaysUntil(e.date) >= 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const nextEvent = sortedEvents[0];

  const openEventsPage = () => {
    const url = athleteId
      ? `https://intervals.icu/athlete/${athleteId}/calendar`
      : 'https://intervals.icu';
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>Upcoming Events</Text>
        <TouchableOpacity onPress={openEventsPage} style={styles.addButton}>
          <MaterialCommunityIcons
            name="open-in-new"
            size={16}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Featured next event */}
      {nextEvent && (
        <View style={[styles.featuredEvent, isDark && styles.featuredEventDark]}>
          <View style={styles.featuredHeader}>
            <View style={styles.priorityBadge}>
              <Text style={[styles.priorityText, { color: PRIORITY_COLORS[nextEvent.priority] }]}>
                {nextEvent.priority} Race
              </Text>
            </View>
            <Text style={[styles.countdown, { color: PRIORITY_COLORS[nextEvent.priority] }]}>
              {getDaysUntil(nextEvent.date)} days
            </Text>
          </View>
          <Text style={[styles.eventName, isDark && styles.textLight]}>
            {nextEvent.name}
          </Text>
          <View style={styles.eventDetails}>
            <Text style={[styles.eventDate, isDark && styles.textDark]}>
              {formatDate(nextEvent.date)}
            </Text>
            {nextEvent.distance && (
              <Text style={[styles.eventDistance, isDark && styles.textDark]}>
                {nextEvent.distance}km
              </Text>
            )}
          </View>
          {nextEvent.notes && (
            <Text style={[styles.eventNotes, isDark && styles.textDark]}>
              {nextEvent.notes}
            </Text>
          )}
        </View>
      )}

      {/* Other events list */}
      <View style={styles.eventsList}>
        {sortedEvents.slice(1).map((event) => (
          <View key={event.id} style={[styles.eventItem, isDark && styles.eventItemDark]}>
            <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[event.priority] }]} />
            <MaterialCommunityIcons
              name={TYPE_ICONS[event.type]}
              size={16}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
              style={styles.eventIcon}
            />
            <View style={styles.eventInfo}>
              <Text style={[styles.eventItemName, isDark && styles.textLight]} numberOfLines={1}>
                {event.name}
              </Text>
              <Text style={[styles.eventItemDate, isDark && styles.textDark]}>
                {formatDate(event.date)} ({getDaysUntil(event.date)}d)
              </Text>
            </View>
            <Text style={[styles.eventPriority, { color: PRIORITY_COLORS[event.priority] }]}>
              {event.priority}
            </Text>
          </View>
        ))}
      </View>

      {sortedEvents.length === 0 && (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons
            name="calendar-plus"
            size={32}
            color={isDark ? darkColors.border : colors.textSecondary}
          />
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No upcoming events
          </Text>
          <Text style={[styles.emptySubtext, isDark && styles.textDark]}>
            Add events on intervals.icu to see them here
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  addButton: {
    padding: spacing.xs,
  },
  featuredEvent: {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  featuredEventDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  featuredHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  priorityBadge: {},
  priorityText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countdown: {
    fontSize: 24,
    fontWeight: '700',
  },
  eventName: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  eventDetails: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  eventDate: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  eventDistance: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  eventNotes: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  eventsList: {
    gap: spacing.xs,
  },
  eventItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  eventItemDark: {
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.sm,
  },
  eventIcon: {
    marginRight: spacing.sm,
  },
  eventInfo: {
    flex: 1,
  },
  eventItemName: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  eventItemDate: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  eventPriority: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    width: 20,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptySubtext: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
