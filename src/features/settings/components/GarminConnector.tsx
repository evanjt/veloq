import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { GarminKeyStatus, type GarminAccount } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { INTERVALS_URLS } from '@/shared/app/constants';
import { sourceFor } from '@/shared/app/source';
import { useAthlete } from '@/shared/app/useAthlete';
import { colors, darkColors, spacing, typography } from '@/theme';
import { Badge, Button, InlineNotice, StatusLine, TextField } from '@/shared/ui';
import { ExternalLinkRow } from '@/shared/ui/ExternalLinkRow';
import { RowDivider } from '@/shared/ui/RowGroup';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { usePermissionUpgrade, useWriteAccessMissing } from '@/features/recording';
import {
  GARMIN_FORUM_THREAD,
  GARMIN_KEY_PAGE,
  connectGarminKey,
  disconnectGarmin,
  garminDuplicateWarning,
  readGarminAccount,
  readGarminChoices,
  readGarminConnectorState,
  saveGarminFeed,
  saveGarminUpload,
  saveGarminAutoSwap,
  type GarminChoices,
  type GarminConnectorState,
} from '../lib/garminConnector';
import { useExperimental } from '../lib/experimental';
import { settingsStyles } from './settingsStyles';

const STATUS_KEY = {
  [GarminKeyStatus.Connected]: 'garmin.statusConnected',
  [GarminKeyStatus.Rejected]: 'garmin.statusRejected',
  [GarminKeyStatus.Malformed]: 'garmin.statusMalformed',
  [GarminKeyStatus.Unreachable]: 'garmin.statusUnreachable',
  [GarminKeyStatus.NoActivityAccess]: 'garmin.statusNoActivityAccess',
} as const;

/** What the device holds: the connector's state, and the choices kept beside the key. */
interface Held {
  state: GarminConnectorState;
  choices: GarminChoices;
}

async function readHeld(): Promise<Held> {
  const [state, choices] = await Promise.all([readGarminConnectorState(), readGarminChoices()]);
  return { state, choices };
}

/**
 * The Garmin connector: the athlete pastes their Personal key, it is kept in
 * the keychain and checked with Garmin, and intervals.icu's own Garmin
 * switches are read and linked to, never changed.
 */
export function GarminConnector() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const garminUpdateOn = useExperimental('garminUpdate');
  const { data: athlete } = useAthlete();
  const { upgradePermissions } = usePermissionUpgrade();
  const writeAccessMissing = useWriteAccessMissing();
  // With no intervals.icu account there is nothing to read its Garmin switches
  // from, no write permission to ask for and no copy of a ride to replace, and
  // the key is the session, so only signing out removes it.
  const authMethod = useAuthStore((state) => state.authMethod);
  const garminOnly = sourceFor({ authMethod })?.id === 'garmin';

  const [connected, setConnected] = useState(false);
  const [keyNeeded, setKeyNeeded] = useState(false);
  const [pasted, setPasted] = useState('');
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<GarminKeyStatus | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [account, setAccount] = useState<GarminAccount | undefined>(undefined);
  const [feedOn, setFeedOn] = useState(true);
  const [uploadOn, setUploadOn] = useState(false);
  const [autoSwapOn, setAutoSwapOn] = useState(false);
  const [autoSwapStopped, setAutoSwapStopped] = useState('');
  const [showMore, setShowMore] = useState(false);

  const showHeld = useCallback(({ state, choices }: Held) => {
    setConnected(state === 'connected');
    setKeyNeeded(state === 'keyNeeded');
    setFeedOn(choices.feed);
    setUploadOn(choices.upload);
    setAutoSwapOn(choices.autoSwap);
    setAutoSwapStopped(choices.autoSwapStopped);
  }, []);

  /**
   * Reads the device again, so a switch or the connection shows what is held
   * after a save or a disconnect that did not finish. A read that fails as
   * well leaves the screen as it is.
   */
  const reloadHeld = useCallback(async () => {
    const held = await readHeld().catch(() => null);
    if (held) showHeld(held);
  }, [showHeld]);

  useEffect(() => {
    let live = true;
    void readHeld().then((held) => {
      if (live) showHeld(held);
    });
    return () => {
      live = false;
    };
  }, [showHeld]);

  const connect = useCallback(async () => {
    setChecking(true);
    setSaveFailed(false);
    try {
      const result = await connectGarminKey(pasted);
      setStatus(result);
      if (result === GarminKeyStatus.Connected) {
        setAccount(await readGarminAccount());
        setConnected(true);
        setKeyNeeded(false);
        setPasted('');
      }
    } catch {
      setSaveFailed(true);
    } finally {
      setChecking(false);
    }
  }, [pasted]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGarmin();
    } catch {
      // Every step has run. The read below shows which of them left the key or a choice behind.
    } finally {
      setStatus(null);
      setAccount(undefined);
      setSaveFailed(false);
    }
    await reloadHeld();
  }, [reloadHeld]);

  const changeFeed = useCallback(
    async (value: boolean) => {
      setFeedOn(value);
      try {
        await saveGarminFeed(value);
      } catch {
        await reloadHeld();
      }
    },
    [reloadHeld]
  );

  const changeUpload = useCallback(
    async (value: boolean) => {
      if (value && writeAccessMissing) {
        const { granted } = await upgradePermissions();
        if (!granted) return;
      }
      setUploadOn(value);
      try {
        await saveGarminUpload(value);
      } catch {
        await reloadHeld();
      }
    },
    [writeAccessMissing, upgradePermissions, reloadHeld]
  );

  const changeAutoSwap = useCallback(
    async (value: boolean) => {
      if (value && writeAccessMissing) {
        const { granted } = await upgradePermissions();
        if (!granted) return;
      }
      setAutoSwapOn(value);
      if (value) setAutoSwapStopped('');
      try {
        await saveGarminAutoSwap(value);
      } catch {
        await reloadHeld();
      }
    },
    [writeAccessMissing, upgradePermissions, reloadHeld]
  );

  const warn = garminDuplicateWarning({
    syncsActivities: athlete?.garminSyncsActivities,
    uploadOn,
  });
  const secondary = { color: palette.textSecondary };
  const connectedLine = account
    ? t('garmin.statusConnectedAs', { name: account.displayName ?? t('garmin.accountFallback') })
    : t('garmin.statusConnected');
  const failure = saveFailed
    ? 'garmin.statusSaveFailed'
    : status !== null && status !== GarminKeyStatus.Connected
      ? STATUS_KEY[status]
      : null;

  return (
    <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
      {garminOnly ? null : (
        <>
          <View style={styles.content}>
            <Text style={[styles.text, secondary]}>{t('garmin.intro')}</Text>
            <ExternalLinkRow
              url={GARMIN_FORUM_THREAD}
              label={t('garmin.readMore')}
              icon="open-in-new"
              testID="garmin-read-more"
            />
          </View>
          <RowDivider />
        </>
      )}
      {connected ? (
        <View style={styles.content}>
          <StatusLine tone="success" message={connectedLine}>
            <Text style={{ color: palette.textPrimary }}>{connectedLine}</Text>
          </StatusLine>
          {garminOnly ? null : (
            <>
              <Text style={[styles.text, secondary]}>{t('garmin.disconnectHint')}</Text>
              <Button
                label={t('garmin.disconnect')}
                variant="destructive"
                onPress={() => void disconnect()}
                testID="garmin-disconnect"
              />
            </>
          )}
        </View>
      ) : (
        <View style={styles.content}>
          {keyNeeded ? (
            <StatusLine tone="info" message={t('garmin.keyNeeded')} testID="garmin-key-needed">
              <Text style={{ color: palette.textPrimary }}>{t('garmin.keyNeeded')}</Text>
              <Text style={[styles.text, secondary]}>{t('garmin.keyNeededHint')}</Text>
            </StatusLine>
          ) : null}
          <ExternalLinkRow
            url={GARMIN_KEY_PAGE}
            label={t('garmin.getKey')}
            icon="open-in-new"
            testID="garmin-get-key"
          />
          <Text style={[styles.text, secondary]}>{t('garmin.getKeyHint')}</Text>
          <TextField
            label={t('garmin.keyLabel')}
            value={pasted}
            onChangeText={setPasted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            testID="garmin-key-input"
          />
          <Text style={[styles.text, secondary]}>{t('garmin.privacy')}</Text>
          {failure !== null ? (
            <StatusLine tone="error" message={t(failure)}>
              <Text style={{ color: palette.textPrimary }}>{t(failure)}</Text>
            </StatusLine>
          ) : null}
          <Button
            label={t('garmin.connect')}
            onPress={() => void connect()}
            loading={checking}
            disabled={pasted.trim() === ''}
            testID="garmin-connect"
          />
        </View>
      )}
      {connected ? (
        <>
          <RowDivider />
          <SwitchRow
            title={t('garmin.feedTitle')}
            description={t('garmin.feedHint')}
            value={feedOn}
            onValueChange={(value) => void changeFeed(value)}
            testID="garmin-feed-switch"
          />
          {garminOnly ? null : (
            <>
              <RowDivider />
              <View style={styles.content}>
                <Button
                  label={t('garmin.moreOptions')}
                  variant="ghost"
                  onPress={() => setShowMore((open) => !open)}
                  expanded={showMore}
                  testID="garmin-more-options"
                />
              </View>
            </>
          )}
          {showMore && !garminOnly ? (
            <>
              <SwitchRow
                title={t('garmin.uploadTitle')}
                description={t('garmin.uploadHint')}
                value={uploadOn}
                onValueChange={(value) => void changeUpload(value)}
                testID="garmin-upload-switch"
              />
              {garminUpdateOn ? (
                <SwitchRow
                  title={t('garmin.autoSwapTitle')}
                  description={t('garmin.autoSwapHint')}
                  value={autoSwapOn}
                  onValueChange={(value) => void changeAutoSwap(value)}
                  accessory={
                    <Badge
                      testID="garmin-auto-swap-experimental"
                      tone="neutral"
                      size="sm"
                      text={t('common.experimental')}
                      isDark={isDark}
                    />
                  }
                  testID="garmin-auto-swap-switch"
                />
              ) : null}
              {garminUpdateOn && autoSwapStopped ? (
                <View style={styles.content}>
                  <InlineNotice
                    tone="warning"
                    icon="alert-outline"
                    title={t('garmin.autoSwapStoppedTitle')}
                    detail={autoSwapStopped}
                    testID="garmin-auto-swap-stopped"
                  />
                </View>
              ) : null}
              {warn ? (
                <View style={styles.content}>
                  <InlineNotice
                    tone="warning"
                    icon="alert-outline"
                    title={t('garmin.duplicateTitle')}
                    detail={t('garmin.duplicateDetail')}
                    testID="garmin-duplicate-warning"
                  />
                  <ExternalLinkRow
                    url={INTERVALS_URLS.connections}
                    label={t('garmin.openConnections')}
                    icon="open-in-new"
                    testID="garmin-open-connections"
                  />
                </View>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  text: {
    ...typography.bodyCompact,
  },
});
