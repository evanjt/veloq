import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { useTranslation } from 'react-i18next';

import { Button, StatusLine, TextField, type TextFieldHandle } from '@/shared/ui';
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
import { isPlainHttp } from '../lib/autobackup/webdavConfig';
import type { NextcloudLogin } from '../lib/autobackup/nextcloudLogin';

/** What committing the form left stored. `empty` is a form with no field filled in. */
export type WebdavCommit =
  { kind: 'stored' } | { kind: 'empty' } | { kind: 'refused'; message: string };

export interface WebdavConfigFormHandle {
  /**
   * Store what the fields show and resolve once the write lands. A field's blur
   * is not enough, since a tap on an action while a field has focus reaches the
   * action first. `required` treats an empty form as refused too.
   */
  commit: (options?: { required?: boolean }) => Promise<WebdavCommit>;
}

interface WebdavConfigFormProps {
  /** The stored credentials changed, so whatever lists backends should read them again. */
  onConfigChange: () => void;
  /** The credentials were removed. */
  onRemoved: () => void;
  ref?: React.Ref<WebdavConfigFormHandle>;
}

/** The WebDAV server fields, Nextcloud QR setup and connection test. */
export function WebdavConfigForm({ onConfigChange, onRemoved, ref }: WebdavConfigFormProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // WebDAV config state, read at first render so the fields paint filled in
  // rather than empty and then replaced a frame later. `getWebdavConfig` is the
  // in-memory cache `initWebdavConfig` filled at startup, so this is a property
  // read and not a SecureStore round trip.
  const [storedWebdav] = useState(getWebdavConfig);
  // Whether credentials are stored, held as state because a successful store sets
  // no other state, so a read of the cache at render would not run again until
  // something else re-rendered the form.
  const [webdavStored, setWebdavStored] = useState(storedWebdav !== null);
  const [webdavUrl, setWebdavUrl] = useState(storedWebdav?.url ?? '');
  const [webdavUser, setWebdavUser] = useState(storedWebdav?.username ?? '');
  const [webdavPass, setWebdavPass] = useState(storedWebdav?.password ?? '');
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

  // A plain http address is allowed, with a warning, because people self-host
  // WebDAV. An address that is not http or https is refused before it is stored.
  const urlProblemText = useCallback(
    (url: string): string | null => {
      const problem = webdavUrlProblem(url);
      if (problem === 'not-http') {
        return t('backup.webdavSchemeRequired', 'Use an http:// or https:// address');
      }
      if (problem === 'invalid') {
        return t('backup.webdavInvalidUrl', 'That is not a valid server address');
      }
      return null;
    },
    [t]
  );

  const showRefusal = useCallback((message: string): WebdavCommit => {
    setConnectionResult('error');
    setConnectionError(message);
    return { kind: 'refused', message };
  }, []);

  // A refused keychain write leaves nothing stored, so the form says so rather
  // than showing filled fields over an unconfigured backup.
  const storeWebdav = useCallback(
    async (url: string, user: string, password: string): Promise<WebdavCommit> => {
      try {
        await setWebdavConfig(url, user, password);
      } catch {
        return showRefusal(
          t('backup.webdavSaveFailed', 'Could not save the server details on this device')
        );
      }
      setWebdavStored(true);
      // Refresh the offer list since WebDAV is now configured
      onConfigChange();
      return { kind: 'stored' };
    },
    [t, onConfigChange, showRefusal]
  );

  const commit = useCallback(
    async ({ required = false }: { required?: boolean } = {}): Promise<WebdavCommit> => {
      const fields: [string, string][] = [
        [webdavUrl, t('backup.serverUrl')],
        [webdavUser, t('backup.username')],
        [webdavPass, t('backup.password')],
      ];
      const missing = fields.filter(([value]) => !value);
      if (missing.length === fields.length) {
        // A cleared form over a stored server would otherwise read as nothing configured
        // while backups still go to that server. Removing it is the Remove button's job.
        if (getWebdavConfig() !== null) {
          return showRefusal(
            t('backup.webdavRemoveFirst', 'Remove the server first to stop backups going to it')
          );
        }
        return required
          ? showRefusal(t('backup.fillAllFields', 'Please fill in all fields'))
          : { kind: 'empty' };
      }
      if (missing.length > 0) {
        return showRefusal(t('backup.fillField', { field: missing[0]?.[1] }));
      }
      const refused = urlProblemText(webdavUrl);
      if (refused) return showRefusal(refused);
      const stored = getWebdavConfig();
      if (
        stored?.url === webdavUrl &&
        stored.username === webdavUser &&
        stored.password === webdavPass
      ) {
        return { kind: 'stored' };
      }
      return storeWebdav(webdavUrl, webdavUser, webdavPass);
    },
    [webdavUrl, webdavUser, webdavPass, t, urlProblemText, showRefusal, storeWebdav]
  );
  useImperativeHandle(ref, () => ({ commit }), [commit]);

  // A blur stores a complete form and leaves a half-typed one quiet.
  const handleSaveWebdav = useCallback(async () => {
    if (!webdavUrl || !webdavUser || !webdavPass) return;
    await commit();
  }, [webdavUrl, webdavUser, webdavPass, commit]);

  const handleRemoveWebdav = useCallback(async () => {
    await clearWebdavConfig();
    setWebdavStored(false);
    setWebdavUrl('');
    setWebdavUser('');
    setWebdavPass('');
    setConnectionResult(null);
    setConnectionError(null);
    onRemoved();
  }, [onRemoved]);

  const plainHttp = isPlainHttp(webdavUrl);

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
      const refused = urlProblemText(webdavEndpoint);
      if (refused) {
        setConnectionResult('error');
        setConnectionError(refused);
        return;
      }
      setConnectionResult(null);
      void storeWebdav(webdavEndpoint, user, password);
    },
    [urlProblemText, storeWebdav]
  );

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    setConnectionError(null);
    if ((await commit({ required: true })).kind !== 'stored') {
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
    setConnectionError(webdavTestMessage(outcome, t, urlProblemText(webdavUrl)));
  }, [commit, urlProblemText, webdavUrl, t]);

  return (
    <>
      <View style={[styles.configBlock, isDark && styles.configBlockDark]}>
        <View style={styles.qrRow}>
          <Button
            label={t('backup.scanNextcloudQr', 'Scan Nextcloud app password')}
            variant="secondary"
            size="sm"
            icon="qrcode-scan"
            onPress={() => setShowQrScanner(true)}
          />
          <InfoButton
            testID="backup-info-nextcloud"
            title={t('backup.scanNextcloudQr', 'Scan Nextcloud app password')}
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
          <Text
            testID="backup-webdav-plain-http-warning"
            accessibilityRole="alert"
            style={[styles.plainHttpWarning, isDark && styles.plainHttpWarningDark]}
          >
            {t(
              'backup.webdavPlainHttpWarning',
              'This address uses http://, so your password and backups travel unencrypted. Use it only with a server you trust on a network you trust.'
            )}
          </Text>
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
          {webdavStored ? (
            <Button
              testID="backup-remove-webdav"
              label={t('common.remove')}
              variant="destructive"
              size="sm"
              onPress={handleRemoveWebdav}
            />
          ) : null}
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
                  { color: isDark ? darkColors.successText : colors.successText },
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
      <FullWindowModal
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
      </FullWindowModal>
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
    color: colors.errorText,
  },
  plainHttpWarning: {
    ...typography.caption,
    color: colors.warningText,
  },
  plainHttpWarningDark: {
    color: darkColors.warningText,
  },
  connectionErrorDark: {
    color: darkColors.errorText,
  },
});
