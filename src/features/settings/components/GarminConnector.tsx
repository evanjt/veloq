import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { GarminKeyStatus } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { INTERVALS_URLS } from '@/shared/app/constants';
import { readCredentialsWithMigration, secureStoreIo } from '@/shared/app/credentialKeychain';
import { useAthlete } from '@/shared/app/useAthlete';
import { colors, darkColors, spacing, typography } from '@/theme';
import { Button, InlineNotice, StatusLine, TextField } from '@/shared/ui';
import { ExternalLinkRow } from '@/shared/ui/ExternalLinkRow';
import { RowDivider } from '@/shared/ui/RowGroup';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { usePermissionUpgrade, useUploadPermissionStore } from '@/features/recording';
import {
  GARMIN_KEY_PAGE,
  GARMIN_KEY_STORAGE_KEY,
  connectGarminKey,
  disconnectGarmin,
  garminDuplicateWarning,
  readGarminChoices,
  saveGarminFeed,
  saveGarminKeyExpiry,
  saveGarminUpload,
} from '../lib/garminConnector';
import { settingsStyles } from './settingsStyles';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isDay(text: string): boolean {
  return ISO_DAY.test(text) && !Number.isNaN(Date.parse(text));
}

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
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);

  const [connected, setConnected] = useState(false);
  const [pasted, setPasted] = useState('');
  const [expiry, setExpiry] = useState('');
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<GarminKeyStatus | null>(null);
  const [feedOn, setFeedOn] = useState(true);
  const [uploadOn, setUploadOn] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { values } = await readCredentialsWithMigration(secureStoreIo, [
        GARMIN_KEY_STORAGE_KEY,
      ]);
      const choices = await readGarminChoices();
      if (!live) return;
      setConnected(Boolean(values[0]));
      setExpiry(choices.keyExpiry);
      setFeedOn(choices.feed);
      setUploadOn(choices.upload);
    })();
    return () => {
      live = false;
    };
  }, []);

  const expiryProblem = expiry !== '' && !isDay(expiry) ? t('garmin.expiryInvalid') : undefined;

  const connect = useCallback(async () => {
    if (expiryProblem) return;
    setChecking(true);
    try {
      const result = await connectGarminKey(pasted);
      setStatus(result);
      if (result === GarminKeyStatus.Connected) {
        setConnected(true);
        setPasted('');
        await saveGarminKeyExpiry(expiry);
      }
    } finally {
      setChecking(false);
    }
  }, [pasted, expiry, expiryProblem]);

  const disconnect = useCallback(async () => {
    await disconnectGarmin();
    setConnected(false);
    setStatus(null);
    setExpiry('');
    setFeedOn(true);
    setUploadOn(false);
  }, []);

  const changeFeed = useCallback((value: boolean) => {
    setFeedOn(value);
    void saveGarminFeed(value);
  }, []);

  const changeUpload = useCallback(
    async (value: boolean) => {
      if (value && hasWritePermission !== true) {
        const { granted } = await upgradePermissions();
        if (!granted) return;
      }
      setUploadOn(value);
      await saveGarminUpload(value);
    },
    [hasWritePermission, upgradePermissions]
  );

  const warn = garminDuplicateWarning({
    syncsActivities: athlete?.garminSyncsActivities,
    uploadOn,
  });
  const secondary = { color: palette.textSecondary };

  return (
    <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
      <View style={styles.content}>
        <Text style={[styles.text, secondary]}>{t('garmin.intro')}</Text>
        <Text style={[styles.text, secondary]}>{t('garmin.privacy')}</Text>
      </View>
      <RowDivider />
      {connected ? (
        <View style={styles.content}>
          <StatusLine tone="success" message={t('garmin.statusConnected')}>
            <Text style={{ color: palette.textPrimary }}>{t('garmin.statusConnected')}</Text>
          </StatusLine>
          {expiry !== '' ? (
            <Text style={[styles.text, secondary]}>{t('garmin.expires', { date: expiry })}</Text>
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
          <TextField
            label={t('garmin.expiryLabel')}
            value={expiry}
            onChangeText={setExpiry}
            placeholder="2027-10-25"
            autoCapitalize="none"
            autoCorrect={false}
            error={expiryProblem}
            testID="garmin-expiry-input"
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
            disabled={pasted.trim() === '' || Boolean(expiryProblem)}
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
