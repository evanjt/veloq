import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useTheme } from '@/shared/app';
import { openExternal } from '@/shared/app/openExternal';
import { useSupportStore } from '@/shared/app/SupportStore';
import {
  GITHUB_ISSUES_URL,
  GITHUB_SPONSORS_URL,
  openForum,
  openStorePage,
} from '@/shared/app/supportLinks';
import { useDonation } from '@/shared/app/useDonation';
import {
  colors,
  darkColors,
  duration,
  iconSize,
  layout,
  motionPresets,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { TipButtons } from '@/shared/ui/TipButtons';
import { Card } from '@/shared/ui/Card';
import { Button, DisclosureChevron, pressable, pressRipple, useLargeText } from '@/shared/ui';

/**
 * Whether the card is on screen, and nothing else.
 *
 * The body is a child so that mounting it is what opens the billing connection.
 * Holding `useDonation` up here bound Play Billing or StoreKit and fetched the
 * products on every feed mount, including the launches where this returns null,
 * which is most of them once the athlete has dismissed the card.
 */
export function SupportCard() {
  // Asked through the selector rather than pulled apart into the four fields
  // it reads: the store re-runs it on every change, which is what the four
  // subscriptions were for.
  const shouldShow = useSupportStore((s) => s.isLoaded && s.shouldShow());
  const [visible, setVisible] = useState(false);

  // The card appears as soon as the store says it should, decided while
  // rendering so the home feed does not commit once without it and reflow.
  if (!visible && shouldShow) {
    setVisible(true);
  }

  if (!visible) return null;
  return <SupportCardBody onDismiss={() => setVisible(false)} />;
}

function SupportCardBody({ onDismiss }: { onDismiss: () => void }) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const { t } = useTranslation();
  const neverShowAgain = useSupportStore((s) => s.neverShowAgain);
  const remindLater = useSupportStore((s) => s.remindLater);
  const recordAction = useSupportStore((s) => s.recordAction);
  const { products, isAvailable, isPurchasing, purchaseSuccess, purchase } = useDonation();

  const [tipsExpanded, setTipsExpanded] = useState(false);
  // Past the large-text cap the two dismiss labels cannot share a row, so they
  // stack and the dot between them goes.
  const stackDismiss = useLargeText();

  const toggleTips = useCallback(() => {
    setTipsExpanded((expanded) => !expanded);
  }, []);

  // Counted only once something opened: a tap that reached no store is not a review.
  const handleReview = useCallback(async () => {
    if (await openStorePage({ review: true })) recordAction();
  }, [recordAction]);

  const handleIdea = useCallback(() => {
    void openExternal(`${GITHUB_ISSUES_URL}?labels=enhancement`);
  }, []);

  const handleForum = useCallback(() => {
    void openForum();
  }, []);

  const handleTip = useCallback(
    (productId: string) => {
      purchase(productId);
    },
    [purchase]
  );

  const handleSponsor = useCallback(() => {
    void openExternal(GITHUB_SPONSORS_URL);
    recordAction();
  }, [recordAction]);

  const handleRemindLater = useCallback(() => {
    remindLater();
    onDismiss();
  }, [remindLater, onDismiss]);

  const handleNeverShow = useCallback(() => {
    neverShowAgain();
    onDismiss();
  }, [neverShowAgain, onDismiss]);

  if (purchaseSuccess) {
    return (
      <Animated.View {...motionPresets.card}>
        <Card variant="raised" style={{ gap: spacing.sm }}>
          <View style={styles.header}>
            <MaterialCommunityIcons name="heart" size={iconSize.md} color={palette.primary} />
            <Text style={[styles.title, isDark && styles.titleDark]}>{t('support.thankYou')}</Text>
          </View>
        </Card>
      </Animated.View>
    );
  }

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <Animated.View testID="support-card" {...motionPresets.card}>
      <Card variant="raised" style={{ gap: spacing.sm }}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="star-outline" size={iconSize.md} color={textColor} />
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('support.enjoyingTitle')}
          </Text>
        </View>
        <Text style={[styles.description, isDark && styles.descriptionDark]}>
          {t('support.feedbackDescription')}
        </Text>

        <View style={styles.actionRow}>
          <ActionButton
            icon="star"
            label={t('support.review')}
            onPress={handleReview}
            isDark={isDark}
          />
          <ActionButton
            icon="lightbulb-outline"
            label={t('support.idea')}
            onPress={handleIdea}
            isDark={isDark}
          />
          <ActionButton
            icon="forum-outline"
            label={t('support.forum')}
            onPress={handleForum}
            isDark={isDark}
          />
        </View>

        <Pressable
          testID="support-card-tip-toggle"
          onPress={toggleTips}
          accessibilityRole="button"
          accessibilityLabel={t('support.supportDevelopment')}
          accessibilityState={{ expanded: tipsExpanded }}
          style={pressable(styles.tipToggle)}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons name="wrench-outline" size={iconSize.sm} color={mutedColor} />
          <Text style={[styles.tipToggleText, { color: mutedColor }]}>
            {t('support.supportDevelopment')}
          </Text>
          <DisclosureChevron expanded={tipsExpanded} size={iconSize.sm} color={mutedColor} />
        </Pressable>

        {/* Mounted only while open: the panel is as tall as its buttons at any text
            size, and a collapsed one leaves no purchase button for a screen reader. */}
        {tipsExpanded ? (
          <Animated.View
            entering={FadeIn.duration(duration.standard)}
            exiting={FadeOut.duration(duration.quick)}
          >
            {isAvailable ? (
              <View testID="support-card-tip-buttons">
                <TipButtons products={products} isPurchasing={isPurchasing} onTip={handleTip} />
              </View>
            ) : (
              <Button
                testID="support-card-sponsor-button"
                onPress={handleSponsor}
                label={t('support.sponsorGitHub')}
                variant="secondary"
                icon="github"
              />
            )}
          </Animated.View>
        ) : null}

        <Animated.View
          layout={LinearTransition.duration(duration.standard)}
          style={[styles.dismissRow, stackDismiss && styles.dismissStacked]}
        >
          <Button
            label={t('support.remindLater')}
            variant="ghost"
            size="sm"
            onPress={handleRemindLater}
          />
          {stackDismiss ? null : (
            <Text style={[styles.dismissSeparator, isDark && styles.dismissTextDark]}>·</Text>
          )}
          <Button
            label={t('support.neverShow')}
            variant="ghost"
            size="sm"
            onPress={handleNeverShow}
          />
        </Animated.View>
      </Card>
    </Animated.View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  isDark: boolean;
}) {
  return (
    <Button
      label={label}
      variant="secondary"
      onPress={onPress}
      style={styles.actionButton}
      icon={icon as keyof typeof MaterialCommunityIcons.glyphMap}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  tipToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: layout.minTapTarget,
  },
  tipToggleText: {
    ...typography.captionBold,
    flex: 1,
  },
  dismissRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  dismissStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  dismissSeparator: {
    ...typography.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.sm,
  },
  dismissTextDark: {
    color: darkColors.textSecondary,
  },
});
