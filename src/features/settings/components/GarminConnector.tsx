import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { GarminKeyStatus, type GarminAccount } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { INTERVALS_URLS } from '@/shared/app/constants';
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
  garminAccountReading,
  garminDuplicateWarning,
  readGarminAccount,
  readGarminChoices,
  readGarminConnectorState,
  saveGarminFeed,
  saveGarminUpload,
  saveGarminAutoSwap,
} from '../lib/garminConnector';
import { settingsStyles } from './settingsStyles';

const STATUS_KEY = {
  [GarminKeyStatus.Connected]: 'garmin.statusConnected',
  [GarminKeyStatus.Rejected]: 'garmin.statusRejected',
  [GarminKeyStatus.Malformed]: 'garmin.statusMalformed',
  [GarminKeyStatus.Unreachable]: 'garmin.statusUnreachable',
} as const;

/**
 * The Garmin connector: the athlete pastes their Personal key, it is kept in
 * the keychain and checked with Garmin, and intervals.icu's own Garmin
 * switches are read and linked to, never changed.
 */
export function GarminConnector() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const { data: athlete } = useAthlete();
  const { upgradePermissions } = usePermissionUpgrade();
  const writeAccessMissing = useWriteAccessMissing();

  const [connected, setConnected] = useState(false);
  const [keyNeeded, setKeyNeeded] = useState(false);
  const [pasted, setPasted] = useState('');
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<GarminKeyStatus | null>(null);
  const [account, setAccount] = useState<GarminAccount | undefined>(undefined);
  const [feedOn, setFeedOn] = useState(true);
  const [uploadOn, setUploadOn] = useState(false);
  const [autoSwapOn, setAutoSwapOn] = useState(false);
  const [autoSwapStopped, setAutoSwapStopped] = useState('');
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const state = await readGarminConnectorState();
      const choices = await readGarminChoices();
      if (!live) return;
      setConnected(state === 'connected');
      setKeyNeeded(state === 'keyNeeded');
      setFeedOn(choices.feed);
      setUploadOn(choices.upload);
      setAutoSwapOn(choices.autoSwap);
      setAutoSwapStopped(choices.autoSwapStopped);
    })();
    return () => {
      live = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setChecking(true);
    try {
      const result = await connectGarminKey(pasted);
      setStatus(result);
      if (result === GarminKeyStatus.Connected) {
        setAccount(await readGarminAccount());
        setConnected(true);
        setKeyNeeded(false);
        setPasted('');
      }
    } finally {
      setChecking(false);
    }
  }, [pasted]);

  const disconnect = useCallback(async () => {
    await disconnectGarmin();
    setConnected(false);
    setKeyNeeded(false);
    setStatus(null);
    setAccount(undefined);
    setFeedOn(true);
    setUploadOn(false);
    setAutoSwapOn(false);
    setAutoSwapStopped('');
  }, []);

  const changeFeed = useCallback((value: boolean) => {
    setFeedOn(value);
    void saveGarminFeed(value);
  }, []);

  const changeUpload = useCallback(
    async (value: boolean) => {
      if (value && writeAccessMissing) {
        const { granted } = await upgradePermissions();
        if (!granted) return;
      }
      setUploadOn(value);
      await saveGarminUpload(value);
    },
    [writeAccessMissing, upgradePermissions]
  );

  const changeAutoSwap = useCallback(
    async (value: boolean) => {
      if (value && writeAccessMissing) {
        const { granted } = await upgradePermissions();
        if (!granted) return;
      }
      setAutoSwapOn(value);
      if (value) setAutoSwapStopped('');
      await saveGarminAutoSwap(value);
    },
    [writeAccessMissing, upgradePermissions]
  );

  const warn = garminDuplicateWarning({
    syncsActivities: athlete?.garminSyncsActivities,
    uploadOn,
  });
  const secondary = { color: palette.textSecondary };
  const reading = account ? garminAccountReading(account) : undefined;
  const accountName = reading?.name ?? t('garmin.accountFallback');
  const connectedLine =
    reading?.kind === 'matched'
      ? t('garmin.statusMatched', { name: accountName, count: reading.count })
      : reading
        ? t('garmin.statusConnectedAs', { name: accountName })
        : t('garmin.statusConnected');

  return (
    <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
      <View style={styles.content}>
        <Text style={[styles.text, secondary]}>{t('garmin.intro')}</Text>
        <Text style={[styles.text, secondary]}>{t('garmin.privacy')}</Text>
        <ExternalLinkRow
          url={GARMIN_FORUM_THREAD}
          label={t('garmin.readMore')}
          icon="open-in-new"
          testID="garmin-read-more"
        />
      </View>
      <RowDivider />
      {connected ? (
        <View style={styles.content}>
          <StatusLine tone="success" message={connectedLine}>
            <Text style={{ color: palette.textPrimary }}>{connectedLine}</Text>
          </StatusLine>
          {reading?.kind === 'wrongAccount' ? (
            <InlineNotice
              tone="warning"
              icon="alert-outline"
              title={t('garmin.wrongAccountTitle')}
              detail={t('garmin.wrongAccountDetail')}
              testID="garmin-account-warning"
            />
          ) : null}
          <Text style={[styles.text, secondary]}>{t('garmin.disconnectHint')}</Text>
          <Button
            label={t('garmin.disconnect')}
            variant="destructive"
            onPress={() => void disconnect()}
            testID="garmin-disconnect"
          />
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
          {status !== null && status !== GarminKeyStatus.Connected ? (
            <StatusLine tone="error" message={t(STATUS_KEY[status])}>
              <Text style={{ color: palette.textPrimary }}>{t(STATUS_KEY[status])}</Text>
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
            onValueChange={changeFeed}
            testID="garmin-feed-switch"
          />
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
          {showMore ? (
            <>
              <SwitchRow
                title={t('garmin.uploadTitle')}
                description={t('garmin.uploadHint')}
                value={uploadOn}
                onValueChange={(value) => void changeUpload(value)}
                testID="garmin-upload-switch"
              />
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
              {autoSwapStopped ? (
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
