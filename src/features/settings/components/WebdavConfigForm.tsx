import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button, StatusLine, SwitchRow, TextField, type TextFieldHandle } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import {
  getWebdavConfig,
  setWebdavConfig,
  clearWebdavConfig,
  testWebdavConnection,
  webdavUrlProblem,
} from '@/features/settings/lib/autobackup';
import { colors, darkColors, spacing, typography } from '@/theme';
import { NextcloudQrScanner } from './NextcloudQrScanner';
import { InfoButton } from './InfoButton';
import { webdavTestMessage } from '../lib/autobackup/webdavTestMessage';
import type { NextcloudLogin } from '../lib/autobackup/nextcloudLogin';

interface WebdavConfigFormProps {
  /** The stored credentials changed, so whatever lists backends should read them again. */
  onConfigChange: () => void;
  /** The credentials were removed. */
  onRemoved: () => void;
}

/** The WebDAV server fields, Nextcloud QR setup and connection test. */
export function WebdavConfigForm({ onConfigChange, onRemoved }: WebdavConfigFormProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // WebDAV config state, read at first render so the fields paint filled in
  // rather than empty and then replaced a frame later. `getWebdavConfig` is the
  // in-memory cache `initWebdavConfig` filled at startup, so this is a property
  // read and not a SecureStore round trip.
  const [storedWebdav] = useState(getWebdavConfig);
  const [webdavUrl, setWebdavUrl] = useState(storedWebdav?.url ?? '');
  const [webdavUser, setWebdavUser] = useState(storedWebdav?.username ?? '');
  const [webdavPass, setWebdavPass] = useState(storedWebdav?.password ?? '');
  const [webdavPlainLan, setWebdavPlainLan] = useState(storedWebdav?.plainLan ?? false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<'success' | 'error' | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const urlInputRef = useRef<TextFieldHandle>(null);
  const focusUrlOnCloseRef = useRef(false);

  // Typing the details in is the way past a camera that is not allowed, so the
  // scanner closes onto the server field with the keyboard up.
  const focusUrlIfAsked = useCallback(() => {
    if (!focusUrlOnCloseRef.current) return;
    focusUrlOnCloseRef.current = false;
    urlInputRef.current?.focus();
  }, []);
  const enterDetailsInstead = useCallback(() => {
    focusUrlOnCloseRef.current = true;
    setShowQrScanner(false);
  }, []);
  // iOS reports the end of the dismissal through `onDismiss`; Android has no
  // such callback and has already removed the modal by the next commit.
  useEffect(() => {
    if (!showQrScanner && Platform.OS !== 'ios') focusUrlIfAsked();
  }, [showQrScanner, focusUrlIfAsked]);

  // Basic credentials and the record archive cross on every backup, so an
  // address that would carry them in the clear is refused before it is stored.
  const urlProblemText = useCallback(
    (url: string, plainLan: boolean): string | null => {
      const problem = webdavUrlProblem(url, plainLan);
      if (problem === 'not-https') {
        return t(
          'backup.webdavHttpsRequired',
          'Use an https:// address. An http:// server would receive your password and record archive unencrypted.'
        );
      }
      if (problem === 'invalid') {
        return t('backup.webdavInvalidUrl', 'That is not a valid server address');
      }
      return null;
    },
    [t]
  );

  // A refused keychain write leaves nothing stored, so the form says so rather
  // than showing filled fields over an unconfigured backup.
  const storeWebdav = useCallback(
    async (url: string, user: string, password: string, plainLan: boolean): Promise<boolean> => {
      try {
        await setWebdavConfig(url, user, password, plainLan);
      } catch {
        setConnectionResult('error');
        setConnectionError(
          t('backup.webdavSaveFailed', 'Could not save the server details on this device')
        );
        return false;
      }
      // Refresh the offer list since WebDAV is now configured
      onConfigChange();
      return true;
    },
    [t, onConfigChange]
  );

  const handleSaveWebdav = useCallback(async (): Promise<boolean> => {
    if (!webdavUrl || !webdavUser || !webdavPass) return false;
    const refused = urlProblemText(webdavUrl, webdavPlainLan);
    if (refused) {
      setConnectionResult('error');
      setConnectionError(refused);
      return false;
    }
    return storeWebdav(webdavUrl, webdavUser, webdavPass, webdavPlainLan);
  }, [webdavUrl, webdavUser, webdavPass, webdavPlainLan, urlProblemText, storeWebdav]);

  const handleRemoveWebdav = useCallback(async () => {
    await clearWebdavConfig();
    setWebdavUrl('');
    setWebdavUser('');
    setWebdavPass('');
    setWebdavPlainLan(false);
    setConnectionResult(null);
    setConnectionError(null);
    onRemoved();
  }, [onRemoved]);

  const handleTogglePlainLan = useCallback((value: boolean) => {
    setWebdavPlainLan(value);
    setConnectionResult(null);
    setConnectionError(null);
  }, []);
  const plainHttp = /^\s*http:/i.test(webdavUrl);

  // The test's outcome is a status message, spoken by the status line it sits
  // in, which stays mounted so a second test's outcome is heard as a change.
  const connectionStatus =
    connectionResult === 'success'
      ? t('backup.connectionSuccess')
      : connectionResult === 'error'
        ? connectionError || t('backup.connectionFailed')
        : null;

  const handleQrScanned = useCallback(
    (login: NextcloudLogin) => {
      const { url: webdavEndpoint, user, password } = login;
      setWebdavUrl(webdavEndpoint);
      setWebdavUser(user);
      setWebdavPass(password);
      setShowQrScanner(false);
      const refused = urlProblemText(webdavEndpoint, webdavPlainLan);
      if (refused) {
        setConnectionResult('error');
        setConnectionError(refused);
        return;
      }
      setConnectionResult(null);
      void storeWebdav(webdavEndpoint, user, password, webdavPlainLan);
    },
    [urlProblemText, webdavPlainLan, storeWebdav]
  );

  const handleTestConnection = useCallback(async () => {
    if (!webdavUrl || !webdavUser || !webdavPass) {
      setConnectionResult('error');
      setConnectionError(t('backup.fillAllFields', 'Please fill in all fields'));
      return;
    }
    setTestingConnection(true);
    setConnectionResult(null);
    setConnectionError(null);
    if (!(await handleSaveWebdav())) {
      setTestingConnection(false);
      return;
    }
    const outcome = await testWebdavConnection();
    setTestingConnection(false);
    if (outcome.kind === 'ok') {
      setConnectionResult('success');
      return;
    }
    setConnectionResult('error');
    setConnectionError(webdavTestMessage(outcome, t, urlProblemText(webdavUrl, webdavPlainLan)));
  }, [handleSaveWebdav, urlProblemText, webdavUrl, webdavUser, webdavPass, webdavPlainLan, t]);

  return (
    <>
      <View style={[styles.configBlock, isDark && styles.configBlockDark]}>
        <View style={styles.qrRow}>
          <Button
            label={t('backup.scanNextcloudQr', 'Scan Nextcloud App Password')}
            variant="secondary"
            size="sm"
            icon={<MaterialCommunityIcons name="qrcode-scan" size={18} color={colors.primary} />}
            onPress={() => setShowQrScanner(true)}
          />
          <InfoButton
            testID="backup-info-nextcloud"
            title={t('backup.scanNextcloudQr', 'Scan Nextcloud App Password')}
            message={t(
              'backup.nextcloudQrHint',
              'Nextcloud → Settings → Security → Create new app password → Scan QR code'
            )}
          />
        </View>
        <TextField
          ref={urlInputRef}
          testID="backup-webdav-url"
          label={t('backup.serverUrl')}
          value={webdavUrl}
          onChangeText={setWebdavUrl}
          onBlur={handleSaveWebdav}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          autoComplete="url"
        />
        {plainHttp ? (
          <SwitchRow
            inset="none"
            title={t('backup.webdavPlainLan', 'Allow an unencrypted server on my own network')}
            value={webdavPlainLan}
            onValueChange={handleTogglePlainLan}
            testID="backup-webdav-plain-lan"
          />
        ) : null}
        <TextField
          testID="backup-webdav-username"
          label={t('backup.username')}
          value={webdavUser}
          onChangeText={setWebdavUser}
          onBlur={handleSaveWebdav}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          autoComplete="username"
        />
        <TextField
          testID="backup-webdav-password"
          label={t('backup.password')}
          value={webdavPass}
          onChangeText={setWebdavPass}
          onBlur={handleSaveWebdav}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
        />
        <View style={styles.testRow}>
          {getWebdavConfig() && (
            <Button
              testID="backup-remove-webdav"
              label={t('common.remove')}
              variant="destructive"
              size="sm"
              onPress={handleRemoveWebdav}
            />
          )}
          <Button
            label={t('backup.testConnection')}
            variant="primary"
            size="sm"
            onPress={handleTestConnection}
            loading={testingConnection}
          />
          <StatusLine
            tone={connectionResult === 'error' ? 'error' : 'success'}
            message={connectionStatus}
          >
            {connectionResult === 'success' && (
              <Text
                style={[
                  styles.connectionSuccess,
                  { color: isDark ? darkColors.successDeep : colors.successDeep },
                ]}
              >
                {connectionStatus}
              </Text>
            )}
            {connectionResult === 'error' && (
              <Text style={[styles.connectionError, isDark && styles.connectionErrorDark]}>
                {connectionStatus}
              </Text>
            )}
          </StatusLine>
        </View>
      </View>
      <Modal
        visible={showQrScanner}
        animationType="slide"
        onRequestClose={() => setShowQrScanner(false)}
        onDismiss={focusUrlIfAsked}
      >
        <NextcloudQrScanner
          onScanned={handleQrScanned}
          onClose={() => setShowQrScanner(false)}
          onEnterDetails={enterDetailsInstead}
        />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  qrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  configBlockDark: {},
  configBlock: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  connectionSuccess: {
    ...typography.caption,
  },
  connectionError: {
    ...typography.caption,
    color: colors.errorDeep,
  },
  connectionErrorDark: {
    color: darkColors.errorDeep,
  },
});
