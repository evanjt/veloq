/**
 * The app's empty state, and the only one.
 *
 * Three fixed forms, by where the empty sits:
 * - `screen` fills a list or a screen, with the icon on a 96 pt disc.
 * - `compact` sits in a section of a detail screen, on a 64 pt disc.
 * - `inline` sits inside a card or under a chart's title. It draws no disc, so
 *   the card keeps its density: the title at `bodySmall` 600, the hint at
 *   `caption`, and a small secondary button when there is an action.
 *
 * The title is the cause line, what is missing, and every form requires it. The
 * description says what fills it, where something does.
 */

import React, { ComponentProps } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Button } from './Button';
import { StatusLine, type StatusTone } from './StatusLine';
import { useTheme } from '@/shared/app';
import {
  colorWithOpacity,
  iconSize,
  ink,
  layout,
  opacity,
  spacing,
  themePalette,
  typography,
} from '@/theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface EmptyStateCommon {
  /** The cause line: what is missing. */
  title: string;
  /** What fills it, where something does. */
  description?: string | undefined;
  /** Action button text */
  actionLabel?: string | undefined;
  /** Action button callback */
  onAction?: (() => void) | undefined;
  /** testID for the action button */
  actionTestID?: string | undefined;
  /** The action is running: its button shows a spinner and refuses a press. */
  actionLoading?: boolean;
  /** How urgently a screen reader speaks it: `error` interrupts, the rest wait. */
  tone?: StatusTone;
  /** Defaults to `empty-state`; the title and hint take it as their prefix. */
  testID?: string;
}

type EmptyStateProps = EmptyStateCommon &
  ({ variant?: 'screen' | 'compact'; icon: IconName } | { variant: 'inline'; icon?: never });

export function EmptyState(props: EmptyStateProps) {
  if (props.variant === 'inline') return <InlineEmptyState {...props} />;
  return <DiscEmptyState {...props} />;
}

function InlineEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionTestID,
  actionLoading = false,
  tone = 'info',
  testID = 'empty-state',
}: EmptyStateCommon) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);

  return (
    <StatusLine
      tone={tone}
      message={[title, description]}
      style={styles.inlineContainer}
      testID={testID}
    >
      <Text style={[styles.inlineTitle, { color: palette.textPrimary }]} testID={`${testID}-title`}>
        {title}
      </Text>
      {description ? (
        <Text
          style={[styles.inlineDescription, { color: palette.textSecondary }]}
          testID={`${testID}-description`}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          {...(actionTestID ? { testID: actionTestID } : {})}
          label={actionLabel}
          onPress={onAction}
          loading={actionLoading}
          variant="secondary"
          size="sm"
        />
      ) : null}
    </StatusLine>
  );
}

function DiscEmptyState({
  variant = 'screen',
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionTestID,
  actionLoading = false,
  tone = 'info',
  testID = 'empty-state',
}: EmptyStateCommon & { variant?: 'screen' | 'compact'; icon: IconName }) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const compact = variant === 'compact';

  return (
    <StatusLine
      tone={tone}
      message={[title, description]}
      style={[styles.container, compact && styles.containerCompact]}
      testID={testID}
    >
      <View
        testID={`${testID}-icon`}
        style={[
          styles.iconContainer,
          {
            backgroundColor: isDark
              ? colorWithOpacity(ink.white, opacity.tint2)
              : colorWithOpacity(ink.black, opacity.tint1),
          },
          compact && styles.iconContainerCompact,
        ]}
      >
        <MaterialCommunityIcons
          name={icon}
          size={compact ? iconSize.xl : iconSize.xxl}
          color={
            isDark
              ? colorWithOpacity(ink.white, opacity.dim)
              : colorWithOpacity(ink.black, opacity.tint4)
          }
        />
      </View>

      <Text
        style={[styles.title, { color: palette.textPrimary }, compact && styles.titleCompact]}
        testID={`${testID}-title`}
      >
        {title}
      </Text>

      {description ? (
        <Text
          style={[
            styles.description,
            { color: palette.textSecondary },
            compact && styles.descriptionCompact,
          ]}
          testID={`${testID}-description`}
        >
          {description}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <Button
          {...(actionTestID ? { testID: actionTestID } : {})}
          label={actionLabel}
          onPress={onAction}
          loading={actionLoading}
          variant="primary"
          style={styles.actionButton}
        />
      ) : null}
    </StatusLine>
  );
}

const EMPTY_STATE_VERTICAL_PADDING = spacing.xl * 2;
/** The inline form's one spacing step, above, between and below its lines. */
const INLINE_SPACING = spacing.sm;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: EMPTY_STATE_VERTICAL_PADDING,
    paddingHorizontal: spacing.lg,
  },
  containerCompact: {
    paddingVertical: spacing.lg,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: layout.borderRadiusFull,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconContainerCompact: {
    width: 64,
    height: 64,
    borderRadius: layout.borderRadiusFull,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.cardTitle,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  titleCompact: {
    ...typography.bodyBold,
  },
  description: {
    ...typography.bodySmall,
    textAlign: 'center',
    maxWidth: 280,
  },
  descriptionCompact: {
    fontSize: typography.bodyCompact.fontSize,
    maxWidth: 240,
  },
  actionButton: {
    marginTop: spacing.lg,
  },
  inlineContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: INLINE_SPACING,
    gap: INLINE_SPACING,
  },
  inlineTitle: {
    ...typography.bodySmallBold,
    textAlign: 'center',
  },
  inlineDescription: {
    ...typography.caption,
    textAlign: 'center',
  },
});
